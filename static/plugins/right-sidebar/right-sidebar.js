(() => {
  class RightSidebarPlugin extends TerraPlugin {
    name = 'rightSidebar';
    css = ['static/plugins/right-sidebar/right-sidebar.css'];

    /**
     * Container a reference to the $('.right-sidebar') container.
     * @type {jQuery.Element}
     */
    $container = jQuery.noop();

    setContent = (content) => {
      if (!this.$container) {
        this.$container = $('<div class="right-sidebar"></div>');
        this.$container.html(content);
        $('.layout-outer-container').append(this.$container);
      } else {
        this.$container.html(content);
      }

      // Trigger a resize such that the golden layout is rendered again.
      $(window).resize();
    }

    destroy = () => {
      this.$container.remove();
      this.$container = null;

      // Trigger a resize such that the golden layout is rendered again.
      $(window).resize();
    }
  }

  Terra.pluginManager.register(new RightSidebarPlugin());

})();
