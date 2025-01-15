(() => {
  const BASE_URL = 'https://agile008.science.uva.nl'
  // const BASE_URL = 'http://localhost:8888';
  init();

  // ===========================================================================
  // Functions
  // ===========================================================================

  function init() {
    createCheck50Button();
  }

  function createCheck50Button() {
    const button = `<button id="run-check50-btn" class="button primary-btn" disabled>Run check50</button>`;
    $('.navbar-right ul').append(button);
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

    const tab = getActiveEditor();
    const filename = tab.config.title;
    const code = tab.instance.editor.getValue();

    console.log('filename', filename);

    const zip = new JSZip();
    zip.file(filename, code);
    zip.generateAsync({
      type: 'blob',
      // compression: "DEFLATE",
      // compressionOptions: {
      //     level: 9
      // }
    }).then((content) => {
      disableCheck50Button();
      const formData = new FormData();
      formData.append('file', content, 'files.zip');
      formData.append('slug', 'minprog/checks/2022/mario/less');
      formData.append('password', 'bwCRJhxzYU5pI7G3iqahFA');

      fetch(`${BASE_URL}/check50`, {
        method: 'POST',
        body: formData,
      })
        .then((response) => response.json())
        .then((response) => {
            pollCheck50Results(response.id);
        }).catch((error) => {
          enableCheck50Button();
        });
    });
  }

  function pollCheck50Results(id) {
    this.check50PollingIntervalId = setInterval(() => {
      fetch(`${BASE_URL}/get/${id}`)
        .then((response) => response.json())
        .then((response) => {
          if (response.status === 'finished') {
            clearInterval(this.check50PollingIntervalId);
            enableCheck50Button();
            showCheck50Results(response.result.check50);
          }
        })
        .catch((error) => {
          enableCheck50Button();
        });
    }, seconds(2));
  }

  function showCheck50Results(response) {
    let html = '<div class="check50-title">Check50 results</div>';

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

    $('.right-sidebar').html(`
      <div class="check50-results-container">
        <div class="check50-close-btn"></div>
        ${html}
      </div>
    `);

    $('.check50-close-btn').click(() => {
      $('.right-sidebar').html('');
      $(window).resize();
    });

    // Trigger a resize such that the content is updated.
    $(window).resize();
  }

})();
