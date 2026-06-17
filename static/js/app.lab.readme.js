/**
 * Fetches a lab's README.md and renders it as HTML into the readme sidebar.
 *
 * Besides regular markdown, the CS50 lab directives are supported:
 *
 *   {% next %} / {% next "Label" %}        pagination: content after the
 *                                          marker is hidden until the user
 *                                          clicks the Next button
 *   {% spoiler %}...{% endspoiler %}       collapsible block, with an
 *                                          optional "Label"
 *   {% video URL %}                        clickable YouTube thumbnail that
 *                                          opens the video in a new tab
 *
 * Videos cannot be embedded as iframes: the app is served with
 * `Cross-Origin-Embedder-Policy: require-corp` (required by the WASM
 * language workers) and YouTube's embed pages do not satisfy that policy.
 *
 * The rendered HTML is sanitized with DOMPurify since the README comes from
 * an arbitrary user-supplied GitHub URL.
 */

import { marked } from './vendor/marked-12.0.2.min.js';
import DOMPurify from './vendor/dompurify-3.1.6.min.js';
import {
  setLocalStorageItem,
  getLocalStorageItem,
} from './lib/local-storage-manager.js';

const SPOILER_REGEX = /\{%\s*spoiler(?:\s+"([^"]*)")?\s*%\}([\s\S]*?)\{%\s*endspoiler\s*%\}/g;
const NEXT_REGEX = /\{%\s*next(?:\s+"([^"]*)")?\s*%\}/;
const VIDEO_REGEX = /\{%\s*video\s+(\S+)\s*%\}/g;
const FRONT_MATTER_REGEX = /^---\n[\s\S]*?\n---\n/;

// Kramdown inline attribute lists, e.g. {:style="max-width:300px"}, used by
// Jekyll-flavored lab markdown. We cannot apply them, so strip them rather
// than render them as literal text.
const KRAMDOWN_ATTR_REGEX = /\{:[^}\n]*\}/g;

/**
 * Fetch the lab's README.md and render it into the given container. The
 * README text is cached in (lab-specific) local storage so it remains
 * available when GitHub is unreachable.
 *
 * @async
 * @param {object} config - The lab config object.
 * @param {jQuery} $container - The element to render the README into.
 */
export async function loadReadme(config, $container) {
  let text = null;

  try {
    const response = await fetch(config.baseUrl + 'README.md');
    if (response.ok) {
      text = await response.text();
      setLocalStorageItem('readme', text);
    }
  } catch (err) {
    console.warn('Failed to fetch README.md:', err);
  }

  if (text === null) {
    text = getLocalStorageItem('readme');
  }

  if (text === null) {
    $container.html('<p class="error">Could not load the lab instructions (README.md).</p>');
    return;
  }

  renderReadme(text, config, $container);
}

/**
 * Render the given README markdown into the container, handling the CS50
 * directives and resolving relative links against the lab's GitHub location.
 *
 * @param {string} text - The raw README markdown.
 * @param {object} config - The lab config object.
 * @param {jQuery} $container - The element to render the README into.
 */
export function renderReadme(text, config, $container) {
  text = text.replace(FRONT_MATTER_REGEX, '');
  text = text.replace(KRAMDOWN_ATTR_REGEX, '');

  // Replace video directives with raw HTML before markdown parsing. The
  // replacement is a single line, so it passes through markdown untouched.
  text = text.replace(VIDEO_REGEX, (match, url) => makeVideoHtml(url));

  // Split into pages on the {% next %} markers. With the capture group,
  // split() yields [page, label, page, label, page, ...] where each label
  // names the button that reveals the page after it.
  const parts = text.split(new RegExp(NEXT_REGEX, 'g'));
  const pages = [];
  for (let i = 0; i < parts.length; i += 2) {
    pages.push({
      html: renderMarkdown(parts[i]),
      buttonLabel: i > 0 ? (parts[i - 1] || 'Next') : null,
    });
  }

  $container.empty();

  const $sections = pages.map((page) => {
    const $section = $('<section class="readme-page hidden-page"></section>').html(page.html);
    resolveRelativeUrls($section, config);
    $container.append($section);
    return $section;
  });

  // Restore how far the user got the previous time.
  let currentPage = parseInt(getLocalStorageItem('readme-page', 0), 10);
  if (isNaN(currentPage)) currentPage = 0;
  currentPage = Math.min(currentPage, pages.length - 1);

  for (let i = 0; i <= currentPage; i++) {
    $sections[i].removeClass('hidden-page');
  }

  const $nextBtn = $('<button type="button" class="button primary-btn readme-next-btn"></button>');

  const placeNextButton = () => {
    if (currentPage >= pages.length - 1) {
      $nextBtn.remove();
      return;
    }

    $nextBtn.text(pages[currentPage + 1].buttonLabel);
    $sections[currentPage].after($nextBtn);
  };

  $nextBtn.on('click', () => {
    currentPage++;
    setLocalStorageItem('readme-page', currentPage);
    $sections[currentPage].removeClass('hidden-page');
    placeNextButton();
    $sections[currentPage][0].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  placeNextButton();
}

/**
 * Render a markdown fragment to sanitized HTML, transforming spoiler
 * directives into <details> blocks. The content between the spoiler markers
 * is rendered separately so the markers may sit anywhere between blocks.
 *
 * @param {string} text - The markdown fragment.
 * @returns {string} Sanitized HTML.
 */
function renderMarkdown(text) {
  let html = '';
  let lastIndex = 0;

  SPOILER_REGEX.lastIndex = 0;
  let match;
  while ((match = SPOILER_REGEX.exec(text)) !== null) {
    const [, label, body] = match;
    html += marked.parse(text.slice(lastIndex, match.index));
    html += `<details class="spoiler"><summary>${escapeHtml(label || 'Spoiler')}</summary>`
      + marked.parse(body)
      + '</details>';
    lastIndex = SPOILER_REGEX.lastIndex;
  }
  html += marked.parse(text.slice(lastIndex));

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
  });
}

/**
 * Build the HTML for a video directive: a clickable thumbnail that opens the
 * video on YouTube in a new tab. Non-YouTube URLs fall back to a plain link.
 *
 * @param {string} url - The video URL from the directive.
 * @returns {string} The replacement HTML (a single line).
 */
function makeVideoHtml(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/))([\w-]+)/);
  if (!match) {
    return `[${url}](${url})`;
  }

  const videoId = match[1];
  return `<a class="video-link" href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg" alt="YouTube video (opens in a new tab)"></a>`;
}

/**
 * Rewrite relative image and link URLs inside a rendered README section.
 * Images resolve against the raw file location of the lab directory, other
 * links against its github.com page. All links open in a new tab.
 *
 * @param {jQuery} $section - The rendered README section.
 * @param {object} config - The lab config object.
 */
function resolveRelativeUrls($section, config) {
  $section.find('img').each((_, img) => {
    const src = $(img).attr('src');
    if (isRelativeUrl(src)) {
      $(img).attr('src', config.baseUrl + src);
    }

    // The app is served with COEP: require-corp (needed by the WASM
    // workers), which blocks cross-origin images unless the host sends a
    // CORP header. Loading in CORS mode instead only requires the much more
    // common Access-Control-Allow-Origin header (GitHub Pages sends it).
    $(img).attr('crossorigin', 'anonymous');
  });

  $section.find('a').each((_, a) => {
    const href = $(a).attr('href');
    if (isRelativeUrl(href)) {
      $(a).attr('href', (config.linkBaseUrl || config.baseUrl) + href);
    }
    $(a).attr('target', '_blank').attr('rel', 'noopener');
  });
}

/**
 * Check whether a URL is relative (no scheme, protocol-relative prefix,
 * absolute path or fragment).
 */
function isRelativeUrl(url) {
  return typeof url === 'string'
    && url.length > 0
    && !/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(url);
}

/**
 * Escape a string for safe interpolation into HTML.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
