# Terra IDE

![A preliminary logo for the Terra IDE](terra-ide-first.jpg)

Integrated development environment (IDE) with an editor and a terminal that can run C or Python
code completely offline using WebAssembly.

[Use it now!](https://ide.proglab.nl)

# Table of Contents

- [Terra IDE](#terra-ide)
- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
- [Structure](#structure)
- [Adding custom header files to C](#adding-custom-header-files-to-c)
- [Create custom wasm32-wasi library](#create-custom-wasm32-wasi-library)
- [Packaging Python files in stdlib](#packaging-python-files-in-stdlib)
- [Enable stdin](#enable-stdin)
- [Acknowledgements](#acknowledgements)

# Getting Started

Simply clone the project:

```
git clone https://github.com/uvapl/terra && cd terra
```

You need some kind of tool that serves static files in order for everything to
work, as it can't be run in `file:///path/to/index.html`.

One example is to use Python's http module: `python3 -m http.server`, then open
`localhost:8000` in your browser and enjoy.

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
`tar -xvf sysroot.tar`. This will extract 3 folder, namely `include`, `lib` and
`share`.

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
```
</details>

The `CFLAGS` contains 
`-I/Users/<USER>/Downloads/wasi-sdk-5.0/opt/wasi-sdk/share/sysroot/include` 
which is needed because `foo.c` includes `<stdio.h>`. Since we compile to
`wasm32-wasi`, we need to include the `wasm32-wasi` header files from the
wasi-sdk.

When running `make`, you should have the `libfoo.a`.

Next, we go one folder up through `cd ..` and then copy the `libfoo.a` and
`foo.h` to the corresponding folder of the `sysroot.tar` we extracted earlier:

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

See [INSTALL_PY_PKG.md](./INSTALL_PY_PKG.md) on how to add a python package to
the pyodide environment.

# Enable stdin

In order to enable stdin, the index.html (or any HTML-file that works with
input) requires the following headers to be sent with every request:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The above allows the usage of
[`WebAssembly.Memory`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory),
which is needed to make shared memory work in order to make input work properly
between the main thread and worker instances.

# Acknowledgements

Thanks to [wasm-clang](https://github.com/binji/wasm-clang) for the amazing
C/C++ in WASM implementation.
