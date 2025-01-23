(() => {
  const BASE_URL = 'https://agile008.science.uva.nl'

  class Check50Plugin extends TerraPlugin {
    css = ['static/plugins/check50/check50.css'];

    /**
     * jQuery object for the button.
     * @type {jQuery.Element}
     */
    $button = jQuery.noop();

    onLayoutLoaded = () => {
      this.$button = this.createTermButton({
        text: 'Run Check50',
        id: 'run-check50-btn',
        class: 'primary-btn',
        onClick: this.runCheck50,
      })
    }

    onEditorFocus = (editorComponent) => {
      if (editorComponent.proglang === 'c' && this.$button.is(':disabled.loading')) {
        this.$button.prop('disabled', false);
      } else {
        this.$button.prop('disabled', true);
      }
    }

    enableCheck50Button = () => {
      this.$button.prop('disabled', false).removeClass('loading');
    }

    disableCheck50Button = () => {
      this.$button.prop('disabled', true).addClass('loading');
    }

    runCheck50 = () => {
      if (this.$button.is(':disabled')) return;

      const tab = Terra.f.getActiveEditor();
      const filename = tab.config.title;
      const code = tab.instance.editor.getValue();

      const zip = new JSZip();
      zip.file(filename, code);
      zip.generateAsync({
        type: 'blob',
        compression: "DEFLATE",
        compressionOptions: {
            level: 9
        }
      }).then((content) => {
        this.disableCheck50Button();
        const formData = new FormData();
        formData.append('file', content, 'files.zip');
        formData.append('slug', 'minprog/checks/2022/mario/less');
        formData.append('password', 'bwCRJhxzYU5pI7G3iqahFA');

        $('.right-sidebar').html(`
          <div class="check50-results-container">
            <div class="check50-close-btn"></div>
            <div class="check50-title">Check50 results</div>
            <p class="connecting">Connecting....</p>
          </div>
        `);

        // Trigger a resize such that the content is updated.
        $(window).resize();

        // Add small connecting animation that adds a dot every 500ms, delayed by 1 second.
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            $('.right-sidebar .connecting').append('.');
          }, Terra.f.seconds(.5) * i + Terra.f.seconds(.5));
        }

        // Add close button handler.
        $('.check50-close-btn').click(() => {
          $('.right-sidebar').html('');
          clearInterval(Terra.v.check50PollingIntervalId);
          this.enableCheck50Button();
          $(window).resize();
        });

        fetch(`${BASE_URL}/check50`, {
          method: 'POST',
          body: formData,
        })
          .then((response) => response.json())
          .then((response) => {
            this.pollCheck50Results(response.id);
          }).catch(() => {
            this.enableCheck50Button();
          });
      });
    }

    pollCheck50Results = (id) => {
      Terra.v.check50PollingIntervalId = setInterval(() => {
        fetch(`${BASE_URL}/get/${id}`)
          .then((response) => response.json())
          .then((response) => {
            if (response.status === 'finished') {
              clearInterval(Terra.v.check50PollingIntervalId);
              this.enableCheck50Button();
              this.showCheck50Results(response.result.check50);
            }
          })
          .catch((error) => {
            this.enableCheck50Button();
          });
      }, Terra.f.seconds(2));
    }

    showCheck50Results = (response) => {
      let html = '';

      if (response.error) {
        const traceback = response.error.traceback.join('').replace('\n', '<br>');
        html += `<div class="error">
          ${response.error.actions.message}<br/>
          <br/>
          ${traceback}
        `;
      } else {
        for (const result of response.results) {
          const statusClass = result.passed ? 'success' : 'error';

          let status = '';
          switch (result.passed) {
            case true: status = ':)'; break;
            case false: status = ':('; break;
            default: status = ':|'; break;
          }

          html += `<div class="check50-result ${statusClass}">
            <div class="check50-result-status">${status}</div>
            <div class="check50-result-message">${result.description}</div>
          </div>`;
        }
      }

      $('.right-sidebar .connecting').remove();
      $('.check50-results-container').append(html);
    }
  }

  Terra.pluginManager.register(new Check50Plugin());

})();
