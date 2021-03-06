#!/usr/bin/node

const path = require(`path`);
const express = require(`express`);
const compression = require(`compression`);
const { Nuxt, Builder } = require(`nuxt`);

const redirectToHttps = require(`./ui/express-middleware/redirect-to-https.js`);
const robotsTxtGenerator = require(`./ui/express-middleware/robots-txt.js`);

const packageJson = require(`./package.json`);
const plugins = require(`./plugins/plugins.json`);
const { fixtureFromRepository } = require(`./lib/model.js`);
const register = require(`./fixtures/register.json`);

require(`./lib/load-env-file.js`);

const app = express();

// setup port
if (!process.env.PORT) {
  process.env.PORT = 5000;
}
app.set(`port`, process.env.PORT);

// redirect to HTTPS site version if environment forces HTTPS
app.use(redirectToHttps);

// support json encoded bodies
app.use(express.json());

// enable compression
app.use(compression({
  threshold: `500B`
}));


// ROUTES

app.get(`/robots.txt`, robotsTxtGenerator);

app.get(`/download.:format([a-z0-9_.-]+)`, (request, response, next) => {
  const { format } = request.params;

  if (!plugins.exportPlugins.includes(format)) {
    next();
    return;
  }

  const fixtures = Object.keys(register.filesystem).filter(
    fixKey => !(`redirectTo` in register.filesystem[fixKey]) || register.filesystem[fixKey].reason === `SameAsDifferentBrand`
  ).map(fixture => {
    const [man, key] = fixture.split(`/`);
    return fixtureFromRepository(man, key);
  });

  const plugin = require(path.join(__dirname, `plugins`, format, `export.js`));
  const outfiles = plugin.export(fixtures, {
    baseDir: __dirname
  });

  downloadFiles(response, outfiles, format);
});

app.get(`/:manKey/:fixKey.:format([a-z0-9_.-]+)`, (request, response, next) => {
  const { manKey, fixKey, format } = request.params;

  if (!(`${manKey}/${fixKey}` in register.filesystem)) {
    next();
    return;
  }

  if (format === `json`) {
    response.json(require(`./fixtures/${manKey}/${fixKey}.json`));
    return;
  }

  if (!plugins.exportPlugins.includes(format)) {
    next();
    return;
  }

  const plugin = require(path.join(__dirname, `plugins`, format, `export.js`));
  const outfiles = plugin.export([fixtureFromRepository(manKey, fixKey)], {
    baseDir: __dirname
  });

  downloadFiles(response, outfiles, `${manKey}_${fixKey}_${format}`);
});

app.get(`/sitemap.xml`, (request, response) => {
  const sitemapCreator = require(`./lib/generate-sitemap.js`);

  response.type(`application/xml`).send(sitemapCreator({
    app,
    url: `${packageJson.homepage}sitemap.xml`
  }));
});

app.post(`/ajax/add-fixtures`, (request, response) => {
  require(`./ui/ajax/add-fixtures.js`)(request, response);
});

app.post(`/ajax/get-search-results`, (request, response) => {
  require(`./ui/ajax/get-search-results.js`)(request, response);
});



// instantiate nuxt.js with the options
const nuxtConfig = require(`./nuxt.config.js`);
nuxtConfig.dev = process.argv[2] === `--dev`;
const nuxt = new Nuxt(nuxtConfig);

// render every remaining route with Nuxt.js
app.use(nuxt.render);

if (nuxtConfig.dev) {
  console.log(`Starting dev server with hot reloading...`);
  new Builder(nuxt).build()
    .then(listen)
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
else {
  // build has been done already
  listen();
}


/**
 * Listen for incoming web requests on the port specified in process.env.PORT
 */
function listen() {
  app.listen(process.env.PORT, () => {
    console.log(`Node app is running on port`, process.env.PORT);
  });
}

/**
 * @typedef ExportFile
 * @type object
 * @property {!string} name filename.ext
 * @property {!string} content file content
 * @property {!string} mimetype e.g. 'text/plain'
 */

/**
 * Instruct Express to initiate a download of one / multiple exported files.
 * @param {!express.Response} response Express Response object
 * @param {!Array.<!ExportFile>} files Array of exported files. If more than one is provided, the files are zipped automatically.
 * @param {!string} zipName Name of the zip file (if any).
 */
function downloadFiles(response, files, zipName) {
  if (files.length === 1) {
    response
      .status(201)
      .attachment(files[0].name)
      .type(files[0].mimetype)
      .send(Buffer.from(files[0].content));
    return;
  }

  // else zip all together
  const Zip = require(`node-zip`);
  const archive = new Zip();
  for (const file of files) {
    archive.file(file.name, file.content);
  }
  const data = archive.generate({
    base64: false,
    compression: `DEFLATE`
  });

  response
    .status(201)
    .attachment(`ofl_export_${zipName}.zip`)
    .type(`application/zip`)
    .send(Buffer.from(data, `binary`));
}
