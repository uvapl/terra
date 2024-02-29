# Examide

Exam website that ships with an editor and a terminal that can run C or Python
code completely offline using WebAssembly.

# Getting Started

Simply clone the project:

```
git clone https://github.com/uvapl/examide && cd examide
```

You need some kind of tool that serves static files in order for everything to
work, as it can't be run in `file:///path/to/index.html`.

One example is to use Python's http module: `python3 -m http.server`, then open
`localhost:8000` in your browser and enjoy.

# Adding custom header files

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


# Acknowledgements

Thanks to [wasm-clang](https://github.com/binji/wasm-clang) for the amazing
C/C++ in WASM implementation.
