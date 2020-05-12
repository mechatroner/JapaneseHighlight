#!/usr/bin/env python3
import fileinput

with fileinput.FileInput('/Users/chenyongjin/codes/project/japanesehighlight/src/scripts/lib/mecab.js', inplace=True, backup='.bak') as file:
    for line in file:
        a = line.replace("var REMOTE_PACKAGE_BASE = 'mecab.data';", """const REMOTE_PACKAGE_BASE = chrome.runtime.getURL("../data/mecab.data");
        """)
        b = a.replace("var wasmBinaryFile = 'mecab.wasm';",
                     """let wasmBinaryFile = chrome.runtime.getURL("../data/mecab.wasm");""")
        print(b, end="")
