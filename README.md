# Examide

Exam website that ships with an editor and a terminal that can run C or Python
code completely offline using WebAssembly.

# Table of Contents

- [Examide](#examide)
- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
- [Structure](#structure)
- [Adding custom header files](#adding-custom-header-files)
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
