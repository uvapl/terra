# Examide

Exam website that ships with an editor and a terminal that can run C or Python
code completely offline using WebAssembly.

# Table of Contents

- [Examide](#examide)
- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
- [Structure](#structure)
- [Adding custom header files to C](#adding-custom-header-files-to-c)
- [Create custom wasm32-wasi library](#create-custom-wasm32-wasi-library)
- [Packaging Python files in stdlib](#packaging-python-files-in-stdlib)
- [Acknowledgements](#acknowledgements)

# Getting Started

Simply clone the project:

```
git clone https://github.com/uvapl/examide && cd examide
```

You need some kind of tool that serves static files in order for everything to
work, as it can't be run in `file:///path/to/index.html`.

One example is to use Python's http module: `python3 -m http.server`, then open
`localhost:8000` in your browser and enjoy.

# Structure

```
.
├── index.html
└── static/
    ├── css/
    │   ├── main.css                # Includes custom css from include/
    │   ├── include/                # Custom app CSS
    │   └── vendor/                 # Third-party CSS
    ├── img/                        # App images, i.e. icons
    ├── js/
    │   ├── constants.js            # Global app constants
    │   ├── helpers.js              # Global app helper functions
    │   ├── layout-components.js    # Main layout and component classes
    │   ├── main.js                 # Bootstraps the app, contains most logic
    │   ├── vendor/                 # Third-party javascript files
    │   ├── worker-api.js           # Bridge between app and other workers
    │   └── workers/                # Language specific workers that compiles and runs the code
    └── wasm                        # WASM files grouped per lang, loaded by corresponding worker
```

# Adding custom header files to C

The `static/wasm/sysroot.tar` contains C++ standard headers and libraries.

Inspecting which header files are included can be done through

```
tar -tf static/wasm/sysroot.tar
```

Including another header `.h` file can be done by extracting the tar, adding the
header and making a new tar. For example:

- `cd ./static/wasm/c_cpp/` make sure you're in this folder
- `tar -xvf sysroot.tar` extract tar
- `cp my-header-file.h ./include/` add custom `my-header-file.h` to the
`include/` folder
- `tar --format ustar -cvf sysroot.tar include lib share` make a new tar
- `rm -rf include lib share` remove previously extracted folders

# Create custom wasm32-wasi library

This project contains a custom `wasm32-wasi`
[cs50](https://github.com/cs50/libcs50) build. This project currently uses
[wasi-sdk-5](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-5),
which provides all the necessary functionality, despite being quite an outdated
version.

To create a custom library archive `.a` file yourself, download the
corresponding `wasi-sdk-5.0-<PLATFORM>.tar.gz` from
[here](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-5) for your
own platform. Then, extract this, for example, in your `~/Downloads` folder.

In order to compile to `wasm32-wasi`, we need to use
`~/Downloads/wasi-sdk-5.0/opt/wasi-sdk/bin/clang`. Consecutively we need to use
`~/Downloads/wasi-sdk-5.0/opt/wasi-sdk/bin/llvm-ar` to create the archive `.a`
file.

Start off with `cd ./static/wasm/c_cpp/` and extract the `sysroot.tar` through
`tar -xvf sysroot.tar`. The tar will extract 3 folder, namely `include`, `lib`
and `share`.

Inside `./static/wasm/c_cpp/`, create a temporary folder for your library. For
the sake of this example, we'll call our library `libfoo` which we can later
link through `-lfoo`. We'll create it through: `mkdir libfoo`.

Next, inside our `libfoo/` folder we have 3 files: `foo.c`, `foo.h` and
`Makefile`, with the following contents:

<details>
<summary>foo.c</summary>

```c
#include <stdio.h>
#include "foo.h"

void say_hello() {
    printf("Hello from foo!\n");
}
```
</details>

<details>
<summary>foo.h</summary>

```c
#ifndef FOO_H
#define FOO_H

void say_hello();

#endif /* FOO_H */
```
</details>

<details>
<summary>Makefile</summary>

```makefile
CC = /Users/<USER>/Downloads/wasi-sdk-5.0/opt/wasi-sdk/bin/clang --sysroot=/Users/<USER>/Downloads/wasi-sdk-5.0/opt/wasi-sdk/share/sysroot
AR = /Users/<USER>/Downloads/wasi-sdk-5.0/opt/wasi-sdk/bin/llvm-ar
CFLAGS = -Wall -Wextra -I/Users/<USER>/Downloads/wasi-sdk-5.0/opt/wasi-sdk/share/sysroot/include

all: libfoo.a

libfoo.a: foo.o
	$(AR) rcs $@ $^

foo.o: foo.c foo.h
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f libfoo.a foo.o

check:
	wasm-objdump -h foo.o
	wasm-ld -v libfoo.a
```
</details>

The `CFLAGS` contains 
`-I/Users/<USER>/Downloads/wasi-sdk-5.0/opt/wasi-sdk/share/sysroot/include` 
which is needed because `foo.c` includes `<stdio.h>`. Since we compile to
`wasm32-wasi`, we need to include the `wasm32-wasi` header files from the
wasi-sdk.

When running `make`, you should have the `libfoo.a`.

Next, we go one folder up through `cd ..` and then copy the `libfoo.a` and
`foo.h` inside the corresponding folder of the sysroot.tar we extracted earlier:

```
$ cp ./libfoo/foo.h ./include
$ cp ./libfoo/libfoo.a ./lib/wasm32-wasi/
```

Next, we create a new tar:

```
rm sysroot.tar && tar -cvf sysroot.tar include lib share
```

Go into your browser settings, clear the cached web content and then finally you
can go into the `./static/js/workers/clang.worker.js` and add `-lfoo` to the
`this.ldflags` inside the constructor:

```javascript
class API extends BaseAPI {
  constructor(options) {

  // ...

    this.ldflags = ['-lc', '-lcs50', '-lfoo'];
  }
}
```

# Packaging Python files in stdlib

The `./static/wasm/py/python_stdlib.zip` contains all the default python modules
that pyodide ships. If you want to import other modules from pypi then it is
recommended to use the `./static/wasm/py/custom_stdlib.zip`.

Let's say you want to import `mypy`, then you should do the following:

- Locally `cd` into `./static/wasm/py/`
- Run `unzip custom_stdlib.zip -d stdlib` to extract the files into a `stdlib` directory
- Run `pip3 install -t . mypy` to install `mypy` and all its dependencies in the current directory
- Run `rm -rf *.so __pycache__ **/__pycache__ bin` to remove unnecessary files
- Run `rm ../custom_stdlib.zip && zip -vr ../custom_stdlib.zip .` to create a new zip
- Run `cd .. && rm -rf stdlib` to remove the folder we just created

It might be that the contents are cached. In that case, clear your browser cache
through the settings.

When refreshing the page, you should be able to import the module directly
inside the front-end editor. However, there might be dependencies. If you have
this error:

```
PythonError: Traceback (most recent call last):
  File "/lib/python311.zip/_pyodide/_base.py", line 499, in eval_code
    .run(globals, locals)
     ^^^^^^^^^^^^^^^^^^^^
  File "/lib/python311.zip/_pyodide/_base.py", line 340, in run
    coroutine = eval(self.code, globals, locals)
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<exec>", line 2, in <module>
ModuleNotFoundError: The module '<MODULE_NAME_HERE>' is included in the Pyodide distribution, but it is not installed.
You can install it by calling:
  await micropip.install("<MODULE_NAME_HERE>") in Python, or
  await pyodide.loadPackage("<MODULE_NAME_HERE>") in JavaScript
See https://pyodide.org/en/stable/usage/loading-packages.html for more details.
```

Then check what `<MODULE_NAME_HERE>` is and repeat the packaging steps described
above for that package as well, until all dependencies are resolved.

# Acknowledgements

Thanks to [wasm-clang](https://github.com/binji/wasm-clang) for the amazing
C/C++ in WASM implementation.
