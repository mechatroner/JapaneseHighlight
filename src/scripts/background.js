// import browser from "webextension-polyfill";
import {
    initContextMenus,
    make_default_online_dicts,
} from './lib/context_menu_lib'
import mecabModule from './lib/mecab'

/* global gapi */

// let gapi = window.api
let gapi_loaded = false
let gapi_inited = false

function report_sync_failure(error_msg) {
    chrome.storage.local.set({ jhLastSyncError: error_msg }, () => {
        chrome.runtime.sendMessage({ sync_feedback: 1 })
    })
}

function load_script(url, callback_func) {
    var request = new XMLHttpRequest()
    request.onreadystatechange = () => {
        if (request.readyState !== 4) return
        if (request.status !== 200) return
        eval(request.responseText)
        callback_func()
    }
    request.open('GET', url)
    request.send()
}

function authorize_user(interactive_authorization) {
    chrome.identity.getAuthToken(
        { interactive: interactive_authorization },
        (token) => {
            if (token === undefined) {
                report_sync_failure('Unable to get oauth token')
            } else {
                gapi.client.setToken({ access_token: token })
                sync_user_vocabularies()
            }
        }
    )
}

// function transform_key(src_key) {
//     var dc = window.atob(src_key)
//     dc = dc.substring(3)
//     dc = dc.substring(0, dc.length - 6)
//     return dc
// }

// function generate_key() {
//     var protokey =
//         'b2ZCQUl6YVN5Q2hqM2xvZkJPWnV2TUt2TGNCSlVaa0RDTUhZa25NWktBa25NWktB'
//     return transform_key(protokey)
// }

function list_to_set(src_list) {
    const result = {}
    for (var i = 0; i < src_list.length; ++i) {
        result[src_list[i]] = 1
    }
    return result
}

function substract_from_set(lhs_set, rhs_set) {
    for (var key in rhs_set) {
        if (
            Object.prototype.hasOwnProperty.call(rhs_set, key) &&
            Object.prototype.hasOwnProperty.call(lhs_set, key)
        ) {
            delete lhs_set[key]
        }
    }
}

function add_to_set(lhs_set, rhs_set) {
    for (var key in rhs_set) {
        if (Object.prototype.hasOwnProperty.call(rhs_set, key)) {
            lhs_set[key] = 1
        }
    }
}

function serialize_vocabulary(entries) {
    const keys = []
    for (var key in entries) {
        if (Object.prototype.hasOwnProperty.call(entries, key)) {
            keys.push(key)
        }
    }
    keys.sort()
    return keys.join('\r\n')
}

function parse_vocabulary(text) {
    // code duplication with parse_vocabulary in import.js
    var lines = text.split('\n')
    var found = []
    for (var i = 0; i < lines.length; ++i) {
        var word = lines[i]
        if (i + 1 === lines.length && word.length <= 1) break
        if (word.slice(-1) === '\r') {
            word = word.slice(0, -1)
        }
        found.push(word)
    }
    return found
}

function create_new_dir(dir_name, success_cb) {
    var body = {
        name: dir_name,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { wdfile: '1' },
    }
    var req_params = {
        path: 'https://www.googleapis.com/drive/v3/files/',
        method: 'POST',
        body: body,
    }
    gapi.client.request(req_params).then((jsonResp) => {
        if (jsonResp.status == 200) {
            success_cb(jsonResp.result.id)
        } else {
            report_sync_failure('Bad dir create status: ' + jsonResp.status)
        }
    })
}

function create_new_file(fname, parent_dir_id, success_cb) {
    var body = {
        name: fname,
        parents: [parent_dir_id],
        appProperties: { wdfile: '1' },
        mimeType: 'text/plain',
    }
    var req_params = {
        path: 'https://www.googleapis.com/drive/v3/files',
        method: 'POST',
        body: body,
    }
    gapi.client.request(req_params).then((jsonResp) => {
        if (jsonResp.status == 200) {
            success_cb(jsonResp.result.id)
        } else {
            report_sync_failure('Bad file create status: ' + jsonResp.status)
        }
    })
}

function upload_file_content(file_id, file_content, success_cb) {
    var req_params = {
        path: 'https://www.googleapis.com/upload/drive/v3/files/' + file_id,
        method: 'PATCH',
        body: file_content,
    }
    gapi.client.request(req_params).then((jsonResp) => {
        if (jsonResp.status == 200) {
            success_cb()
        } else {
            report_sync_failure('Bad upload content status: ' + jsonResp.status)
        }
    })
}

function fetch_file_content(file_id, success_cb) {
    // https://developers.google.com/drive/v3/web/manage-downloads
    var full_query_url =
        'https://www.googleapis.com/drive/v3/files/' + file_id + '?alt=media'
    gapi.client
        .request({ path: full_query_url, method: 'GET' })
        .then((jsonResp) => {
            if (jsonResp.status != 200) {
                report_sync_failure(
                    'Bad status: ' +
                        jsonResp.status +
                        ' for getting content of file: ' +
                        file_id
                )
                return
            }
            var file_content = jsonResp.body
            success_cb(file_id, file_content)
        })
}

function find_gdrive_id(query, found_cb, not_found_cb) {
    // generic function to find single object id
    var full_query_url =
        'https://www.googleapis.com/drive/v3/files?q=' +
        encodeURIComponent(query)
    gapi.client
        .request({ path: full_query_url, method: 'GET' })
        .then((jsonResp) => {
            if (jsonResp.status != 200) {
                report_sync_failure(
                    'Bad status: ' + jsonResp.status + ' for query: ' + query
                )
                return
            }
            if (jsonResp.result.files.length > 1) {
                report_sync_failure(
                    'More than one object found for query: ' + query
                )
                return
            } else if (jsonResp.result.files.length == 1) {
                var drive_id = jsonResp.result.files[0].id
                found_cb(drive_id)
                return
            }
            not_found_cb()
        })
}

function apply_cloud_vocab(entries) {
    var sync_date = new Date()
    var sync_time = sync_date.getTime()
    var new_state = {
        jhLastSyncError: null,
        jhUserVocabulary: entries,
        wd_user_vocab_added: {},
        wd_user_vocab_deleted: {},
        jhLastSync: sync_time,
    }
    chrome.storage.local.set(new_state, () => {
        chrome.runtime.sendMessage({ sync_feedback: 1 })
    })
}

function sync_vocabulary(dir_id, vocab) {
    const merge_and_upload_vocab = (file_id, file_content) => {
        const vocab_list = parse_vocabulary(file_content)
        var entries = list_to_set(vocab_list)
        substract_from_set(entries, vocab.deleted)
        add_to_set(entries, vocab.added)
        const merged_content = serialize_vocabulary(entries)

        const set_merged_vocab = () => {
            apply_cloud_vocab(entries)
        }
        upload_file_content(file_id, merged_content, set_merged_vocab)
    }

    const merge_vocab_to_cloud = (file_id) => {
        fetch_file_content(file_id, merge_and_upload_vocab)
    }

    var vocab_file_name = vocab.name + '.txt'
    var file_query =
        "name = '" +
        vocab_file_name +
        "' and trashed = false and appProperties has { key='wdfile' and value='1' } and '" +
        dir_id +
        "' in parents"
    const create_new_file_wrap = () => {
        create_new_file(vocab_file_name, dir_id, merge_vocab_to_cloud)
        var new_added = {}
        add_to_set(new_added, vocab.all)
        add_to_set(new_added, vocab.added)
        vocab.added = new_added
    }
    find_gdrive_id(file_query, merge_vocab_to_cloud, create_new_file_wrap)
}

function backup_vocabulary(dir_id, vocab, success_cb) {
    const merge_and_upload_backup = (file_id, file_content) => {
        const vocab_list = parse_vocabulary(file_content)
        var entries = list_to_set(vocab_list)
        add_to_set(entries, vocab.all)
        add_to_set(entries, vocab.deleted)
        add_to_set(entries, vocab.added)
        const merged_content = serialize_vocabulary(entries)
        upload_file_content(file_id, merged_content, success_cb)
    }
    const merge_backup_to_cloud = (file_id) => {
        fetch_file_content(file_id, merge_and_upload_backup)
    }

    var backup_file_name = '.' + vocab.name + '.backup'
    var backup_query =
        "name = '" +
        backup_file_name +
        "' and trashed = false and appProperties has { key='wdfile' and value='1' } and '" +
        dir_id +
        "' in parents"
    const create_new_backup_file_wrap = () => {
        create_new_file(backup_file_name, dir_id, merge_backup_to_cloud)
    }
    find_gdrive_id(
        backup_query,
        merge_backup_to_cloud,
        create_new_backup_file_wrap
    )
}

function perform_full_sync(vocab) {
    var dir_name = 'Words Discoverer Sync'
    var dir_query =
        "name = '" +
        dir_name +
        "' and trashed = false and appProperties has { key='wdfile' and value='1' }"
    const backup_and_sync_vocabulary = (dir_id) => {
        const sync_vocabulary_wrap = () => {
            sync_vocabulary(dir_id, vocab)
        }
        backup_vocabulary(dir_id, vocab, sync_vocabulary_wrap)
    }
    const create_new_dir_wrap = () => {
        create_new_dir(dir_name, backup_and_sync_vocabulary)
    }
    find_gdrive_id(dir_query, backup_and_sync_vocabulary, create_new_dir_wrap)
}

function sync_user_vocabularies() {
    chrome.storage.local.get(
        ['jhUserVocabulary', 'wd_user_vocab_added', 'wd_user_vocab_deleted'],
        (result) => {
            var jhUserVocabulary = result.jhUserVocabulary
            var wd_user_vocab_added = result.wd_user_vocab_added
            var wd_user_vocab_deleted = result.wd_user_vocab_deleted
            if (typeof jhUserVocabulary === 'undefined') {
                jhUserVocabulary = {}
            }
            if (typeof wd_user_vocab_added === 'undefined') {
                wd_user_vocab_added = Object.assign({}, jhUserVocabulary)
            }
            if (typeof wd_user_vocab_deleted === 'undefined') {
                wd_user_vocab_deleted = {}
            }
            var vocab = {
                name: 'japanese_vocabulary',
                all: jhUserVocabulary,
                added: wd_user_vocab_added,
                deleted: wd_user_vocab_deleted,
            }
            perform_full_sync(vocab)
        }
    )
}

function init_gapi(interactive_authorization) {
    // const gapikey = generate_key()
    // const init_params = { apiKey: gapikey }
    const init_params = { apiKey: 'AIzaSyB8O49UstOB-K_hB09_HaDA4E-VN6qmHrw' }
    gapi.client.init(init_params).then(
        () => {
            gapi_inited = true
            authorize_user(interactive_authorization)
        },
        (reject_reason) => {
            var error_msg =
                'Unable to init client. Reject reason: ' + reject_reason
            console.error(error_msg)
            report_sync_failure(error_msg)
        }
    )
}

function load_and_init_gapi(interactive_authorization) {
    load_script('https://apis.google.com/js/api.js', () => {
        gapi.load('client', () => {
            gapi_loaded = true
            init_gapi(interactive_authorization)
        })
    })
}

function start_sync_sequence(interactive_authorization) {
    chrome.storage.local.set(
        { jhLastSyncError: 'Unknown sync problem' },
        () => {
            if (!gapi_loaded) {
                load_and_init_gapi(interactive_authorization)
            } else if (!gapi_inited) {
                init_gapi(interactive_authorization)
            } else {
                authorize_user(interactive_authorization)
            }
        }
    )
}

function initialize_extension() {
    const mecabPromise = new mecabModule()
    mecabPromise.then((mecab) => {
        const args = '-r mecabrc -d unidic/ input.txt -o output.txt'
        mecab.FS.createDataFile('/', 'input.txt', '', true, true)
        const mecabDo = mecab.cwrap('mecab_do2', 'number', ['string'])
        const spaceRegex = /[\s\n]/g

        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (!request.text) return
                const processedText = request.text.replace(spaceRegex, '、')
                mecab.FS.writeFile('input.txt', processedText)
                mecabDo(args)
                const output = mecab.FS.readFile('output.txt', {
                    encoding: 'utf8',
                })
                sendResponse({ output })
            }
        )
    })

    chrome.runtime.onMessage.addListener((request, sender) => {
        // if (request.wdm_request == "hostname") {
        // const tab_url = sender.tab.url;
        // var url = new URL(tab_url);
        // var domain = url.hostname;
        // sendResponse({ wdm_hostname: domain });
        // } else
        if (request.wdm_verdict) {
            if (request.wdm_verdict == 'highlight') {
                chrome.storage.local.get(
                    ['jhGdSyncEnabled', 'jhLastSyncError'],
                    (result) => {
                        chrome.browserAction.setIcon(
                            {
                                path: '../images/result48.png',
                                tabId: sender.tab.id,
                            },
                            () => {
                                if (result.jhGdSyncEnabled) {
                                    if (result.jhLastSyncError == null) {
                                        chrome.browserAction.setBadgeText({
                                            text: 'sync',
                                            tabId: sender.tab.id,
                                        })
                                        chrome.browserAction.setBadgeBackgroundColor(
                                            {
                                                color: [25, 137, 0, 255],
                                                tabId: sender.tab.id,
                                            }
                                        )
                                    } else {
                                        chrome.browserAction.setBadgeText({
                                            text: 'err',
                                            tabId: sender.tab.id,
                                        })
                                        chrome.browserAction.setBadgeBackgroundColor(
                                            {
                                                color: [137, 0, 0, 255],
                                                tabId: sender.tab.id,
                                            }
                                        )
                                    }
                                }
                            }
                        )
                    }
                )
            } else if (request.wdm_verdict == 'keyboard') {
                chrome.browserAction.setIcon({
                    path: '../images/no_dynamic.png',
                    tabId: sender.tab.id,
                })
            } else {
                chrome.browserAction.setIcon({
                    path: '../images/result48_gray.png',
                    tabId: sender.tab.id,
                })
            }
        } else if (request.wdm_new_tab_url) {
            var fullUrl = request.wdm_new_tab_url
            chrome.tabs.create({ url: fullUrl })
        } else if (request.wdm_request == 'gd_sync') {
            start_sync_sequence(request.interactive_mode)
        }
    })

    chrome.storage.local.get(
        [
            'jhHlSettings',
            'jhOnlineDicts',
            'jhHoverSettings',
            'jhIsEnabled',
            'jhUserVocabulary',
            'jhBlackList',
            'jhWhiteList',
            'jhGdSyncEnabled',
            'jhEnableTTS',
            'jhJpnDict',
            'jhMinimunRank',
        ],
        (result) => {
            // load_eng_dictionary();
            // load_idioms();
            if (typeof result.jhMinimunRank === 'undefined') {
                chrome.storage.local.set({ jhMinimunRank: 6000 })
            }

            const jhHlSettings = result.jhHlSettings
            if (typeof jhHlSettings == 'undefined') {
                const word_hl_params = {
                    enabled: true,
                    quoted: false,
                    bold: true,
                    useBackground: false,
                    backgroundColor: 'rgb(255, 248, 220)',
                    useColor: true,
                    color: 'red',
                }
                const idiom_hl_params = {
                    enabled: true,
                    quoted: false,
                    bold: true,
                    useBackground: false,
                    backgroundColor: 'rgb(255, 248, 220)',
                    useColor: true,
                    color: 'blue',
                }
                const jhHlSettings = {
                    wordParams: word_hl_params,
                    idiomParams: idiom_hl_params,
                }
                chrome.storage.local.set({ jhHlSettings: jhHlSettings })
            }
            const jhEnableTTS = result.jhEnableTTS
            if (typeof jhEnableTTS == 'undefined') {
                chrome.storage.local.set({ jhEnableTTS: false })
            }
            const jhHoverSettings = result.jhHoverSettings
            if (typeof jhHoverSettings == 'undefined') {
                const jhHoverSettings = {
                    hl_hover: 'always',
                    ow_hover: 'never',
                }
                chrome.storage.local.set({ jhHoverSettings: jhHoverSettings })
            }
            var jhOnlineDicts = result.jhOnlineDicts
            if (typeof jhOnlineDicts == 'undefined') {
                const jhOnlineDicts = make_default_online_dicts()
                chrome.storage.local.set({ jhOnlineDicts: jhOnlineDicts })
            }
            initContextMenus(jhOnlineDicts)

            const jhIsEnabled = result.jhIsEnabled
            if (typeof jhIsEnabled === 'undefined') {
                chrome.storage.local.set({ jhIsEnabled: true })
            }
            const user_vocabulary = result.jhUserVocabulary
            if (typeof user_vocabulary === 'undefined') {
                chrome.storage.local.set({ jhUserVocabulary: {} })
            }
            const black_list = result.jhBlackList
            if (typeof black_list === 'undefined') {
                chrome.storage.local.set({ jhBlackList: {} })
            }
            const white_list = result.jhWhiteList
            if (typeof white_list === 'undefined') {
                chrome.storage.local.set({ jhWhiteList: {} })
            }
        }
    )

    chrome.runtime.onMessage.addListener((request) => {
        if (request.type === 'tts_speak') {
            if (request.word && typeof request.word === 'string') {
                chrome.tts.speak(request.word, { lang: 'ja' })
            }
        }
    })
}

initialize_extension()
