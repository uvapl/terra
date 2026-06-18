import './ide/commands.ide.js';

import IDEApp from './app.ide.js';
import Terra from './terra.js';
import commands from './commands.js';
import { initMenubar } from './layout/menubar.js';
import { loadPlugins } from './plugin-manager.js';

const plugins = [
  'run-as',
  'check50',
  'right-sidebar',
  'shell',
  // 'editor-unlink-killer',
];

loadPlugins(plugins).then(() => {
    Terra.app = new IDEApp();

    // Build the menubar from the registered commands (core + plugin) and bind
    // global shortcuts before the app initialises its layout.
    commands.buildMenu('.menubar');
    initMenubar();
    commands.installGlobalKeyboard();

    Terra.app.init();
});
