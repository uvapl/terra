(() => {
  const BASE_URL = 'https://agile008.science.uva.nl'

  class Check50Plugin extends TerraPlugin {
    css = ['static/plugins/check50/check50.css'];

    onLayoutLoaded() {
      createCheck50Button();
    }

    onEditorFocus(editorComponent) {
      if (editorComponent.proglang === 'c' && $('#run-check50-btn:disabled.loading').length == 0) {
        $('#run-check50-btn').prop('disabled', false);
      } else {
        $('#run-check50-btn').prop('disabled', true);
      }
    }
  }

  Terra.pluginManager.register(new Check50Plugin());

  // ===========================================================================
  // Functions
  // ===========================================================================

  function createCheck50Button() {
    const button = `<button id="run-check50-btn" class="button primary-btn" disabled>Run check50</button>`;
    $('.terminal-component-container .lm_header').append(button);
    $('#run-check50-btn').click(runCheck50);
  }

  function enableCheck50Button() {
    $('#run-check50-btn').prop('disabled', false).removeClass('loading');
  }

  function disableCheck50Button() {
    $('#run-check50-btn').prop('disabled', true).addClass('loading');
  }

  function runCheck50() {
    if ($('#run-check50-btn:disabled').length > 0) return;

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
      disableCheck50Button();
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
        enableCheck50Button();
        $(window).resize();
      });

      fetch(`${BASE_URL}/check50`, {
        method: 'POST',
        body: formData,
      })
        .then((response) => response.json())
        .then((response) => {
          pollCheck50Results(response.id);
        }).catch(() => {
          enableCheck50Button();
        });
    });
  }

  function pollCheck50Results(id) {
    Terra.v.check50PollingIntervalId = setInterval(() => {
      fetch(`${BASE_URL}/get/${id}`)
        .then((response) => response.json())
        .then((response) => {
          if (response.status === 'finished') {
            clearInterval(Terra.v.check50PollingIntervalId);
            enableCheck50Button();
            showCheck50Results(response.result.check50);
          }
        })
        .catch((error) => {
          enableCheck50Button();
        });
    }, Terra.f.seconds(2));
  }

  function showCheck50Results(response) {
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
          case null: status = ':|'; break;
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

})();
