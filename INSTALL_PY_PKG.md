# Table of Contents

- [Table of Contents](#table-of-contents)
- [Packaging Python files in stdlib](#packaging-python-files-in-stdlib)
    + [Download whl-file through pyodide](#download-whl-file-through-pyodide)
    + [Install package contents through pipo](#install-package-contents-through-pipo)
  * [Running it in the browser](#running-it-in-the-browser)

# Packaging Python files in stdlib

The `./static/wasm/py/python_stdlib.zip` contains all the default python modules
that pyodide ships. If you want to import other modules from pypi then it is
recommended to modify the `./static/wasm/py/custom_stdlib.zip`.

There's a [requirements.txt](./static/wasm/py/requirements.txt) that is not
used, but just to keep track of the packages that have been added in the
custom_stdlib.zip. Please update this when adding another package to the zip.

There are two ways to import a module and both are quite tedious:
1) Download `.whl` file through pyodide (recommended)
2) Install the package contents through `pip3 install -t . <pkg>`

Below I'll cover both of these.

### Download whl-file through pyodide

Pyodide offers some built-in packages, which you can see
[here](https://pyodide.org/en/stable/usage/packages-in-pyodide.html).

You need to know the `.whl` URLs that you need to download. For that, you can
use the small HTML file below:

<details>
  <summary>pyodide-pkg-finder.html</summary>

```html
<!doctype html>
<html>

<head>
  <script src="https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js"></script>
</head>

<body>
  <label>Package name:</label>
  <input type="text" placeholder="Enter python package name" />
  <button id="find-urls-btn">Show URLs</button>
  <div id="output">Loading...</div>

  <script>
    function setOutput(msg, overwrite) {
      if (overwrite) {
        document.getElementById('output').innerText = msg;
      } else {
        document.getElementById('output').innerText += msg;
      }
    }

    printWhlUrls = (pkg) => {
      console.log('pkg:', pkg)
      const pkgInfo = window.pyodide._api.lockfile_packages[pkg];
      if (!pkgInfo) return;

      setOutput(`wget https://cdn.jsdelivr.net/pyodide/v0.25.1/full/${pkgInfo.file_name}\n`);

      pkgInfo.depends.forEach((dep) => {
        printWhlUrls(dep);
      });
    }

    loadPyodide().then((pyodide) => {
      window.pyodide = pyodide;
      setOutput('Ready', true);
      document.getElementById('find-urls-btn').addEventListener('click', () => {
        const pkg = document.querySelector('input').value;
        if (!pyodide._api.lockfile_packages[pkg]) {
          setOutput(`Package ${pkg} not found in lockfile`, true);
        } else {
          setOutput('', true);
          printWhlUrls(pkg);
        }
      });
    })
  </script>
</body>

</html>
```
</details>

Save the HTML code below locally in a file and open it in your browser. Simply fill in a
package name. If it exists, the website will output all URLs that you need to
download. For example, searching for `pandas` will yield:

```
https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pandas-1.5.3-cp311-cp311-emscripten_3_1_46_wasm32.whl
https://cdn.jsdelivr.net/pyodide/v0.25.1/full/numpy-1.26.4-cp311-cp311-emscripten_3_1_46_wasm32.whl
https://cdn.jsdelivr.net/pyodide/v0.25.1/full/python_dateutil-2.8.2-py2.py3-none-any.whl
https://cdn.jsdelivr.net/pyodide/v0.25.1/full/six-1.16.0-py2.py3-none-any.whl
https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pytz-2023.3-py2.py3-none-any.whl
```

Then, execute the following steps:

- Locally `cd` into `./static/wasm/py/`
- Run `unzip custom_stdlib.zip -d stdlib && cd stdlib` to extract the files into a `stdlib` directory
- For each of the URLs from `pyodide-pkg-finder.html`, run `wget <url>`
- Then, for each `.whl` file, run `unzip <whl-file>`
- Run `rm -rf *.whl *.so __pycache__ **/__pycache__ bin` to remove unnecessary files
- Run `rm ../custom_stdlib.zip && zip -vr ../custom_stdlib.zip .` to create a new zip
- Run `cd .. && rm -rf stdlib` to remove the folder we just created

Continue to [Running it in the browser](#running-it-in-the-browser)

### Install package contents through pipo

At this point, you should be **certain** that pyodide does not provide the
package that you want to install.

Let's say you want to import `mypy`, then you should do the following:

- Locally `cd` into `./static/wasm/py/`
- Run `unzip custom_stdlib.zip -d stdlib && cd stdlib` to extract the files into a `stdlib` directory
- Run `pip3 install -t . mypy` to install `mypy` and all its dependencies in the current directory
- Run `rm -rf *.so __pycache__ **/__pycache__ bin` to remove unnecessary files
- Run `rm ../custom_stdlib.zip && zip -vr ../custom_stdlib.zip .` to create a new zip
- Run `cd .. && rm -rf stdlib` to remove the folder we just created

Continue to [Running it in the browser](#running-it-in-the-browser)

## Running it in the browser

Now that you've recreated the zip, you can reload your webpage.

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
