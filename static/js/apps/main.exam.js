import CourseApp from './app.course.js';
import Terra from '../terra.js';
import { loadPlugins } from '../lib/plugin-manager.js';

// Karel registers its worker and canvas from onLayoutLoaded, so it only has to
// be registered before the app builds its layout.
loadPlugins(['karel']).then(() => {
  // The connected page: it always belongs to a course-site, and shows whatever
  // coursework that course-site hands out — a set of files of its own, or a lab.
  Terra.app = new CourseApp({
    connected: true,
    orientation: 'horizontal',
    storage: 'exam',
    resetOnBoot: true,
    name: 'Terra Exam',
  });
  Terra.app.init();
});
