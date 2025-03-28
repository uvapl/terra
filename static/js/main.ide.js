import './ide/menubar.js';

import IDEApp from './app.ide.js';
import Terra from './terra.js';
import pluginManager from './plugin-manager.js';

pluginManager.loadPlugins([
  'check50',
  'file-args',
  'right-sidebar',
]);

Terra.app = new IDEApp();
Terra.app.init();
