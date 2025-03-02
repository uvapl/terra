class IDEApp extends App {
  setupLayout = () => {
    Terra.layout = this.createLayout();
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {boolean} [forceDefaultLayout=false] Whether to force the default layout.
   * @param {Array} [contentConfig=[]] The content configuration for the layout.
   * @returns {Layout} The layout instance.
   */
  createLayout = (forceDefaultLayout = false, contentConfig = []) => {
    const defaultContentConfig = contentConfig.map((tab) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize: Terra.c.BASE_FONT_SIZE,
        ...tab.componentState,
      },
      title: 'Untitled',
      ...tab,
    }))

    const defaultLayoutConfig = {
      settings: {
        showCloseIcon: false,
        showPopoutIcon: false,
        showMaximiseIcon: true,
        reorderEnabled: true,
      },
      dimensions: {
        headerHeight: 30,
        borderWidth: 10,
      },
      content: [
        {
          type: 'column',
          content: [
            {
              type: 'stack',
              content: defaultContentConfig.length > 0 ? defaultContentConfig : [
                {
                  type: 'component',
                  componentName: 'editor',
                  componentState: {
                    fontSize: Terra.c.BASE_FONT_SIZE,
                  },
                  title: 'Untitled',
                },
              ],
            },
            {
              type: 'component',
              componentName: 'terminal',
              componentState: { fontSize: Terra.c.BASE_FONT_SIZE },
              isClosable: false,
              reorderEnabled: false,
            }
          ]
        }
      ]
    };

    return new LayoutIDE(defaultLayoutConfig, { forceDefaultLayout });
  }

}
