# Examide

Exam website that ships with an editor and a terminal that can run C or Python
code completely offline using WebAssembly.

# Table of Contents

- [Examide](#examide)
- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
- [Structure](#structure)
- [Adding custom header files to C](#adding-custom-header-files-to-c)
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
