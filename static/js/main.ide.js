import './ide/menubar.js';

import IDEApp from './app.ide.js';
import Terra from './terra.js';
import pluginManager from './plugin-manager.js';

const plugins = [
  'check50',
  'file-args',
  'right-sidebar',
];

pluginManager.loadPlugins(plugins).then(() => {
    Terra.app = new IDEApp();
    Terra.app.init();
});
