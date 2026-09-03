import CourseApp from './app.course.js';
import Terra from '../terra.js';
import { loadPlugins } from '../lib/plugin-manager.js';

// Karel registers its worker and canvas from onLayoutLoaded, so it only has to
// be registered before the app builds its layout.
loadPlugins(['karel']).then(() => {
  // The standalone page: a lab worked on locally, with no course-site to submit
  // to and nothing to lock it. Files stay in this browser, so the session is
  // resumable rather than reset on every visit.
  Terra.app = new CourseApp({
    storage: 'lab',
    landingForm: true,
    name: 'Terra Lab',
  });
  Terra.app.init();
});
