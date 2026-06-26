// Ace syntax mode for the Karel language. Defined via ace.define against the
// global `ace` (loaded as a classic script before the app modules), so when the
// editor asks for `ace/mode/karel` the module is already registered — no lazy
// HTTP load is attempted. Keywords are hyphenated and matched case-insensitively.

ace.define(
  'ace/mode/karel_highlight_rules',
  ['require', 'exports', 'module', 'ace/lib/oop', 'ace/mode/text_highlight_rules'],
  function (require, exports) {
    const oop = require('ace/lib/oop');
    const { TextHighlightRules } = require('ace/mode/text_highlight_rules');

    const KarelHighlightRules = function () {
      const keywords =
        'beginning-of-program|end-of-program|beginning-of-execution|' +
        'end-of-execution|define|define-new-instruction|as|begin|end|' +
        'iterate|times|while|do|if|then|else|world|speed|slow|fast';

      const primitives = 'move|turnleft|pickbeeper|putbeeper|turnoff';

      const tests =
        'front-is-clear|front-is-blocked|left-is-clear|left-is-blocked|' +
        'right-is-clear|right-is-blocked|next-to-a-beeper|not-next-to-a-beeper|' +
        'any-beepers-in-beeper-bag|no-beepers-in-beeper-bag|facing-north|' +
        'not-facing-north|facing-south|not-facing-south|facing-east|' +
        'not-facing-east|facing-west|not-facing-west|not';

      const keywordMapper = this.createKeywordMapper(
        {
          'keyword.control': keywords,
          'support.function': primitives,
          'support.constant': tests,
        },
        'identifier',
        true // case-insensitive
      );

      this.$rules = {
        start: [
          { token: 'comment', regex: /\/\/.*$/ },
          { token: 'comment', regex: /\{/, next: 'blockComment' },
          { token: 'string', regex: /"[^"]*"/ },
          { token: 'constant.numeric', regex: /\b\d+\b/ },
          {
            token: keywordMapper,
            regex: /[a-zA-Z][a-zA-Z0-9-]*/,
          },
          { token: 'punctuation.operator', regex: /;/ },
        ],
        blockComment: [
          { token: 'comment', regex: /\}/, next: 'start' },
          { defaultToken: 'comment' },
        ],
      };
    };

    oop.inherits(KarelHighlightRules, TextHighlightRules);
    exports.KarelHighlightRules = KarelHighlightRules;
  }
);

ace.define(
  'ace/mode/karel',
  [
    'require',
    'exports',
    'module',
    'ace/lib/oop',
    'ace/mode/text',
    'ace/mode/karel_highlight_rules',
  ],
  function (require, exports) {
    const oop = require('ace/lib/oop');
    const { Mode: TextMode } = require('ace/mode/text');
    const { KarelHighlightRules } = require('ace/mode/karel_highlight_rules');

    const Mode = function () {
      this.HighlightRules = KarelHighlightRules;
      this.lineCommentStart = '//';
      this.$id = 'ace/mode/karel';
    };
    oop.inherits(Mode, TextMode);

    exports.Mode = Mode;
  }
);
