#!/usr/bin/env python3
import fileinput

toremoves = ['var out = Module["print"] || console.log.bind(console);',
             'var err = Module["printErr"] || console.warn.bind(console);', 'addRunDependency("gl-prefetch");',
             'addRunDependency("worker-init");',
             'assert(!Browser.doSwapBuffers);',
             'Browser.doSwapBuffers = postRAF;']

with fileinput.FileInput('/Users/chenyongjin/codes/project/japanesehighlight/src/scripts/lib/mecab_worker.js', inplace=True, backup='.bak') as file:
    for line in file:
        a = line.replace('"mecab.data"', "mecabDataPath")
        b = a.replace('"mecab.wasm"', "mecabWasmPath")
        # a = line.replace("'mecab.data'", "mecabDataPath")
        # b = a.replace("'mecab.wasm'", "mecabWasmPath")
        c = b
        for toremove in toremoves:
            c = c.replace(toremove, "")
        print(c, end="")

# chrome-extension://ihdojpdjcdllbkophghfbedkiibiggbl/data
