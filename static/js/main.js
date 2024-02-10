const initialProgram =
`#include <stdio.h>

int main() {
    int num;
    printf("Enter a number: ");
    scanf("%d", &num);
    printf("The number you entered is %d\\n", num);
    return 0;
}
`;

const initialProgram2 =
`#include <stdio.h>

int main(void)
{
    printf("Hello from test2.c");
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
    borderWidth: 10,
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
              componentState: {
                fontSize: fontSize,
                value: initialProgram
              },
              title: 'test1.c',
              isClosable: false,
            },
            {
              type: 'component',
              componentName: 'editor',
              componentState: {
                fontSize: fontSize,
                value: initialProgram2
              },
              title: 'test2.c',
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
  defaultLayoutConfig,
});

layout.init();
