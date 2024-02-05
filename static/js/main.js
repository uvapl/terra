const initialProgram =
  `#include <stdio.h>

int main(void)
{
    int height = 8;

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

    return 0;
}
`;

// Update font-size for all components on change.
$('.font-size').change((event) => {
  const newFontSize = parseInt(event.target.value);
  layout.root.contentItems[0].contentItems.forEach((contentItem) => {
    contentItem.contentItems.forEach((item) => {
      item.container.emit('fontSizeChanged', newFontSize);
    })
  });
  setLocalStorageItem('font-size', newFontSize);
});

const fontSize = getLocalStorageItem('font-size', 18);

const defaultLayoutConfig = {
  settings: {
    showCloseIcon: false,
    showPopoutIcon: false,
    showMaximiseIcon: false,
    showCloseIcon: false,
  },
  dimensions: {
    headerHeight: 30,
    borderWidth: 8,
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
              componentState: { fontSize: fontSize, value: initialProgram },
              title: 'snake.c',
              isClosable: false,
            },
            {
              type: 'component',
              componentName: 'editor',
              componentState: { fontSize: fontSize, value: initialProgram },
              title: 'hello.c',
              isClosable: false,
            },
          ]
        },
        {
          type: 'component',
          componentName: 'terminal',
          componentState: { fontSize: fontSize },
          isClosable: false,
        }
      ]
    }
  ]
};

const layout = new Layout({
  configKey: `${LOCAL_STORAGE_PREFIX}-layout`,
  defaultLayoutConfig,
});

layout.init();
