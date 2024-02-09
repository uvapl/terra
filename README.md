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

Including another header `.h` file can be done by making a custom `include/`
folder with the header files you want and simply append them to the `sysroot.tar`.

Example (assuming cwd is the root of this repository):

```sh
$ mkdir include/                                         # Create a new include folder
$ cp /usr/local/include/cs50.h include/                  # Copy system local cs50.h to the include folder
$ tar --append --file=static/wasm/sysroot.tar include/*  # Append cs50.h to the sysroot.tar
$ tar -tf static/wasm/sysroot.tar | tail                 # Optionally, you can confirm your file has been added
$ rm -rf include/                                        # Remove the include folder
```

To see the changes, make sure to do a "hard refresh"" in your browser to see the
changes, which can be done in most browsers through:

- MacOS: <kbd>CMD</kbd> + <kbd>Shift</kbd> + <kbd>r</kbd>
- Windows: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>r</kbd>

Alternatively, remove the *Cache Storage* entries through the web inspector in your browser.

# Acknowledgements

Thanks to [wasm-clang](https://github.com/binji/wasm-clang) for the amazing
C/C++ in WASM implementation.
