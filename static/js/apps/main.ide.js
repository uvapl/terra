import IDEApp from './app.ide.js';
import Terra from '../terra.js';
import { loadPlugins } from '../lib/plugin-manager.js';

const plugins = [
  'run-as',
  'check50',
  'right-sidebar',
  'shell',
  'karel',
  // 'editor-unlink-killer',
];

loadPlugins(plugins).then(() => {
    // The controller registers the IDE command config and builds the menubar +
    // global keyboard during setupLayout (see IDEController). All that is left
    // here is to construct and initialise the app.
    Terra.app = new IDEApp();
    Terra.app.init();
});
