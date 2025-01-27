(() => {
  const BASE_URL = 'https://agile008.science.uva.nl'

  class Check50Plugin extends TerraPlugin {
    name = 'check50';
    css = ['static/plugins/check50/check50.css'];

    /**
     * Reference to the Check50 button element.
     * @type {jQuery.Element}
     */
    $button = jQuery.noop();

    /**
     * Reference to the right sidebar plugin.
     * @type {TerraPlugin}
     */
    rightSidebarPlugin = null;

    /**
     * A one-time flag to determine if the page is loaded for the first time.
     * @type {boolean}
     */
    gitfsIsPageLoad = true;

    defaultState = {
      // The password to use for the check50 endpoint.
      password: null,

      // Example key-value pairs:
      // 'absolute/folder/path/to/mario.c': 'minprog/checks/2022/mario/less'
      fileslugs: {},
    }

    onPluginRegistered = (plugin) => {
      if (plugin.name === 'rightSidebar') {
        this.rightSidebarPlugin = Terra.f.getPlugin('rightSidebar');
      }
    }

    onLayoutLoaded = () => {
      this.$button = this.createTermButton({
        text: 'Run Check50',
        id: 'run-check50-btn',
        class: 'primary-btn',
        onClick: this.onButtonClick,
        disabled: true,
      });
    }

    onEditorFocus = (editorComponent) => {
      if (editorComponent.proglang === 'c' && !this.$button.is(':disabled.loading')) {
        this.$button.prop('disabled', false);
      } else {
        this.$button.prop('disabled', true);
      }
    }

    onStorageChange = (storageName, prevStorageName) => {
      // We don't want to clear the storage when the user reload the page and
      // was already using a certain filesystem (gitfs/LFS) before reloading.
      // The state should only be cleared when switching storages after reload
      // the page.
      if (prevStorageName && storageName !== prevStorageName) {
        this.clearState('fileslugs');
      }
    }

    enableCheck50Button = () => {
      this.$button.prop('disabled', false).removeClass('loading');
    }

    disableCheck50Button = () => {
      this.$button.prop('disabled', true).addClass('loading');
    }

    onButtonClick = () => {
      if (this.$button.is(':disabled')) return;

      const tab = Terra.f.getActiveEditor();
      const fileId = tab.container.getState().fileId;
      const filepath = Terra.vfs.getAbsoluteFilePath(fileId);

      // Check if the file has a slug and the check50 password is set.
      // Otherwise, if one of them is not set, prompt the user to fill in the
      // remaining missing values.
      let hasSlug = this.getState('fileslugs').hasOwnProperty(filepath);
      let hasPassword = this.getState('password');
      if (!hasSlug || !hasPassword) {
        let body = '';

        if (!hasSlug) {
          body += `
            <div class="form-wrapper-full-width">
              <label>Slug:</label>
              <input type="text" class="text-input full-width-input slug" placeholder="Fill in the corresponding slug for this file" />
            </div>
          `
        }

        if (!hasPassword) {
          body += `
          <div class="form-wrapper-full-width">
            <label>Password:</label>
            <input type="password" class="text-input full-width-input password" placeholder="Fill in the check50 password" />
          </div>
          `
        }

        const $modal = createModal({
          title: 'Check50 information required',
          body,
          footer: `
            <button type="button" class="button cancel-btn">Cancel</button>
            <button type="button" class="button primary-btn">Run Check50</button>
          `,
          attrs: {
            id: 'terra-plugin-run-check50-modal',
            class: 'modal-width-small',
          }
        });

        showModal($modal);

        $modal.find('.cancel-btn').click(() => hideModal($modal));
        $modal.find('.primary-btn').click(() => {
          if ($modal.find('.password').length > 0) {
            const password = $modal.find('.password').val().trim();
            if (password) {
              hasPassword = true;
              this.setState('password', password);
            } else {
              hasPassword = false;
            }
          }

          if ($modal.find('.slug').length > 0) {
            const slug = $modal.find('.slug').val().trim();
            if (slug) {
              hasSlug = true;
              this.setState('fileslugs', {
                ...this.getState('fileslugs'),
                [filepath]: slug
              });
            } else {
              hasSlug = false;
            }
          }

          if (hasPassword && hasSlug) {
            this.runCheck50();
            hideModal($modal);
          }
        });
      } else {
        this.runCheck50();
      }
    }

    runCheck50 = () => {
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
        const fileId = tab.container.getState().fileId;
        const filepath = Terra.vfs.getAbsoluteFilePath(fileId);
        const slug = this.getState('fileslugs')[filepath];

        this.disableCheck50Button();
        const formData = new FormData();
        formData.append('file', content, 'files.zip');
        formData.append('slug', slug);
        formData.append('password', this.getState('password'));

        this.rightSidebarPlugin.setContent(`
          <div class="check50-results-container">
            <div class="check50-close-btn"></div>
            <div class="check50-title">Check50 results</div>
            <p class="connecting">Connecting....</p>
          </div>
        `);

        // Add small connecting animation that adds a dot every 500ms, delayed by 1 second.
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            this.rightSidebarPlugin.$container.find('.connecting').append('.');
          }, Terra.f.seconds(.5) * i + Terra.f.seconds(.5));
        }

        // Add close button handler.
        $('.check50-close-btn').click(() => {
          clearInterval(Terra.v.check50PollingIntervalId);
          this.enableCheck50Button();
          this.rightSidebarPlugin.destroy();
        });

        fetch(`${BASE_URL}/check50`, {
          method: 'POST',
          body: formData,
        })
          .then((response) => response.json())
          .then((response) => {
            this.pollCheck50Results(response.id);
          }).catch((error) => {
            this.enableCheck50Button();
            this.rightSidebarPlugin.$container.find('.connecting').remove();
            this.rightSidebarPlugin.$container.find('.check50-results-container').append(`<p class="error">Failed to submit check50</p>`)
          });
      })
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

      this.rightSidebarPlugin.$container.find('.connecting').remove();
      this.rightSidebarPlugin.$container.find('.check50-results-container').append(html);
    }
  }

  Terra.pluginManager.register(new Check50Plugin());

})();
