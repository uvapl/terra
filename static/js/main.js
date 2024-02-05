const LAYOUT_CONFIG_KEY = 'uva-tentamen-ide';

const initialProgram =
  `#include <stdio.h>

int main(void)
{
    int height = 0;
    do
    {
        printf("What is the height of the pyramid?");
        scanf("%d", &height);
        height = 7;
    }
    while (height < 1 || height > 8);

    printf("\\n");
    for (int lijn = 0; lijn < height; lijn++)
    {
        for (int spatie = 1; spatie <= height-lijn - 1; spatie++)
        {
            printf(" ");
        }
        for(int breedte=0; breedte <= lijn; breedte++)
        {
          printf("#");
        }
        {
          printf("\\n");
        }
    }
}
`;

// Golden Layout
function initLayout() {
  const defaultLayoutConfig = {
    settings: {
      showCloseIcon: false,
      showPopoutIcon: false,
      showMaximiseIcon: false,
      showCloseIcon: false,
    },
    content: [
      {
        type: 'row',
        isClosable: false,
        content: [
          {
            type: 'stack',
            isClosable: false,
            content: [
              {
                type: 'component',
                componentName: 'editor',
                componentState: { fontSize: 18, value: initialProgram },
                title: 'file1',
                isClosable: false,
              },
              {
                type: 'component',
                componentName: 'editor',
                componentState: { fontSize: 18, value: initialProgram },
                title: 'file2',
                isClosable: false,
              },
            ]
          },
          {
            type: 'component',
            componentName: 'terminal',
            componentState: { fontSize: 18 },
            isClosable: false,
          }
        ]
      }
    ]
  };

  const layout = new Layout({
    configKey: LAYOUT_CONFIG_KEY,
    defaultLayoutConfig,
  });

  layout.on('initialised', event => {
    // Run code on keypress
    editor.commands.addCommand({
      name: 'run',
      bindKey: { win: 'Ctrl+Enter', mac: 'Command+Enter' },
      exec: run
    });
  });

  layout.registerComponent('canvas', CanvasComponent);
  layout.init();

  return layout;
}

$('#run').on('click', event => run(editor));
layout = initLayout();
