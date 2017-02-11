import Spooky from 'spooky';
import rl from 'readline-sync';

const ask = (msg, options) => {
  return rl.question(msg, options)
};

class UrlGlobals {
  constructor() {
    const defaultUrl = 'https://github.com/appacademy/curriculum'
    let targetUrl = ask(`Enter the URL of the target repo: (${defaultUrl})`);
    if (targetUrl.length === 0) {
      targetUrl = defaultUrl;
    }
    this.targetUrl = targetUrl;
    let scopeUrl = ask(`Enter the URL of the scope repo: (${targetUrl})`);
    if (scopeUrl.length === 0) {
      scopeUrl = targetUrl;
    }
    this.scopeUrl = scopeUrl;
    const defaultWiki = this.defaultWiki(targetUrl);
    const isWiki = ask(`Is your target repo a wiki?: (${defaultWiki})`)
    const parsedWiki = isWiki.length > 0 && isWiki.toLowerCase() === 'y' ? true : false;
    this.isWiki = parsedWiki;
  }

  defaultWiki(targetUrl) {
    const isWiki = targetUrl.indexOf('/wiki') === -1 ? false : true;
    return isWiki ? 'Y/n' : 'y/N';
  }
}

class User {
  constructor() {
    this.username = ask("Enter your Github username: ");
    this.password = ask("Enter your Github password: ", { noEchoBack: true });
  }
}

const globals = new UrlGlobals;

const spooky = new Spooky({
  child: {
    transport: 'http',
  },
  casper: {
    logLevel: 'debug',
    verbose: false
  }
}, (err) => {
  if (err) {
    let e = new Error('Failed to initialize SpookyJS');
    e.details = err;
    throw e;
  }

  // Visit Github
  spooky.start('https://github.com/login');
  spooky.then(function (res) {
    this.emit('clearscreen');
    this.emit('hello', 'About to attempt login at: ' + this.evaluate(() => {
      return document.title;
    }));
  });

  // Fill in form and submit it
  spooky.then([
    {
      user: new User,
    },
    function () {
      this.fill(
        'form',
        {
          'login': user.username,
          'password': user.password
        },
        true
      );
    }
  ]);

  // Wait for page to be something other than /login or /session
  spooky.waitFor([{ patterns: ['/login', 'session'] }, function () {
    const currentUrl = this.getCurrentUrl().toLowerCase();
    for (let i = 0; i < patterns.length; i++) {
      if (currentUrl.indexOf(patterns[i]) !== -1) return false;
    }
    return true;
  }]);

  // Log information to the user
  spooky.then([
    {
      targetUrl: globals.targetUrl,
    }, function () {
      const currentUrl = this.getCurrentUrl();
      if (currentUrl === 'https://github.com/') {
        this.emit('console', 'Successully logged in!')
        this.emit('console', `About to perform crawl on: ${targetUrl}`);
      } else {
        this.emit('console', 'Error logging in.');
        this.exit();
      }
  }]);

  // Visit the target URL
  spooky.thenOpen(globals.targetUrl);

  // Log the current location and add initial links
  spooky.then(function (res) {
    const currentUrl = this.getCurrentUrl();
    this.emit('console', `Currently located at: ${currentUrl}`);
    const rootLink = {
      url: currentUrl,
      text: '(N/A: Root Link)',
      currentUrl: currentUrl
    };
    window.linkQueue = [rootLink];
    window.count = 1;
    window.visitedLinks = {};
    window.brokenLinks = [];
    window.selectorErrors = [];
  });

  // Start the traversal
  spooky.then([{ globals }, runScan]);

  // Double check the broken links
  spooky.then(function () {
    this.emit('console', 'The broken links are as follows:');
    this.emit('console', window.brokenLinks);
    this.repeat(window.brokenLinks.length, function () {
      const currentLink = window.brokenLinks.shift();
      this.thenOpen(currentLink, function (res) {
        if (res.status >= 400 && res.status !== 418) {
          window.brokenLinks.push(currentLink);
        }
      });
    });
  });

  spooky.run();
});

spooky.on('error', function (e, stack) {
  console.error(e);
  if (stack) {
    console.log(stack);
  }
});

spooky.on('console', line => {
  console.log(line);
});

spooky.on('clearscreen', () => {
  process.stdout.write('\u001B[2J\u001B[0;0f');
});

const runScan = function() {
  const pluralize = (num, singular, plural) => {
    const pluralization = plural || `${singular}s`;
    if (num === 1) {
      return `${num} ${singular}`;
    } else {
      return `${num} ${pluralization}`;
    }
  }
  this.repeat(window.linkQueue.length, function () {
    let currentLink = window.linkQueue.shift();
    let currentUrl = currentLink.url;
    this.emit('console', `About to open ${currentUrl}, which is linked from ${currentLink.currentUrl}`);
    this.thenOpen(currentUrl, function (res) {
      // Some websites always respond with the "I'm a teapot" status code
      if (res.status >= 400 && res.status !== 418) {
        window.brokenLinks.push(currentLink);
      }
    });
    const previouslyVisited = !!window.visitedLinks[currentUrl];
    const inScope = currentUrl.slice(0, globals.targetUrl.length) === globals.targetUrl;
    if (!previouslyVisited && inScope) {
      const targetDivSelector = globals.isWiki ? 'wiki-wrapper' : 'readme';
      this.waitForSelector(`#${targetDivSelector}`, function () {
        const links = this.evaluate(function (currentUrl, targetDivSelector) {
          const targetDiv = document.getElementById(targetDivSelector);
          let newLinks = Array.from(targetDiv.querySelectorAll('a:not(.anchor)'));
          newLinks = newLinks.map(function (link) {
            let url = link.getAttribute('href');
            if (url[0] === '/') {
              url = `https://github.com${url}`;
            }
            const text = link.innerHTML;
            const linkItem = { url, currentUrl, text };

            return linkItem;
          });
          return newLinks;
        }, { currentUrl, targetDivSelector });

        if (links) {
          links.forEach(link => {
            window.linkQueue.push(link);
          });
          this.emit('console', `${pluralize(links.length, 'link')} added to queue.`)
        }
        window.visitedLinks[currentUrl] = true;
      }, function () {
        const error = `Unable to find a target div with selector #${targetDivSelector} at ${currentUrl}`;
        window.selectorErrors.push(error);
      });
    }
    this.then(function () {
      this.emit('clearscreen');
      this.emit('console', `${pluralize(window.count, 'link')} traversed.`);
      this.emit('console', `${pluralize(window.linkQueue.length, 'link')} are remaining.`);
      this.emit('console', `${pluralize(window.brokenLinks.length, 'broken link')} found.`);
      window.brokenLinks.forEach(function (link, i) {
        this.emit('console', `Broken Link #${i + 1}:`);
        this.emit('console', `href points to: ${link.url}`);
        this.emit('console', `Appears on page: ${link.currentUrl}`);
        this.emit('console', `Has the following clickable text: ${link.text}`);
      });
      window.selectorErrors.forEach(function (err) {
        this.emit('console', err);
      });
      window.count += 1;
    });
  });
  this.then(function (res) {
    runScan.call(this);
  });
}
