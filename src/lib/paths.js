'use strict';

const path = require('path');

const root = process.env.ICO_DESIGNER_ROOT
  ? path.resolve(process.env.ICO_DESIGNER_ROOT)
  : path.resolve(__dirname, '..', '..');

const paths = {
  root,
  res: path.join(root, 'res'),
  configs: path.join(root, 'configs'),
  artifact: path.join(root, 'artifact'),
  cache: path.join(root, '.cache'),
  editor: path.join(root, 'src', 'editor'),
  templates: path.join(root, 'src', 'templates'),
};

function configFile(name) {
  return path.join(paths.configs, `${name}.toml`);
}

function configDir(name) {
  return path.join(paths.configs, name);
}

function isInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { paths, configFile, configDir, isInside };
