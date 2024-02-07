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
