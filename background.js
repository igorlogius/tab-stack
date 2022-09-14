/* global browser */

const manifest = browser.runtime.getManifest();
const extname = manifest.name;
const tab2top = new Map();
let multipleHighlighted = false;


function isStacked(id){
    return tab2top.has(id);
}

function isTop(id){
    return (id === tab2top.get(id));
}

function getTop(id){
    return tab2top.get(id);
}

function setTop(id){

    const old_top = getTop(id);
    const new_top = id;

    tab2top.set(old_top, new_top);
    tab2top.set(new_top, new_top);

    const tmp = [];
    for(const [k,v] of tab2top){
        if( v === old_top){
            tmp.push(k);
        }
    }
    for(const k of tmp){
        tab2top.set(k, new_top);
    }
}

function getRest(id) {
    const topId = getTop(id);
    let tmp = [];
    for(const [k,v] of tab2top){
        if( v === topId && v !== k){
            tmp.push(k);
        }
    }
    return tmp;
}

async function unstack(tab){

    if(isStacked(tab.id)){

        const topTab= getTop(tab.id);

        let tmp = [topTab];
        for(const [k,v] of tab2top){
            if( v === topTab){
                if(v !== k){
                    tmp.push(k);
                }
                tab2top.delete(k);
            }
        }
        browser.tabs.update(topTab, { pinned: false, active: true, highlighted: true});
        browser.tabs.move(tmp, {index: -1});
        browser.tabs.show(tmp);

        notify(extname, 'Unstack (menu)');
        onTabActivated({tabId: topTab.id, windowId: topTab.windowId});
    }else{
        notify(extname, 'active tab not stacked, nothing to unstack');
    }
}

async function stack() {

    const selectedTabs = (await browser.tabs.query({ currentWindow: true, highlighted: true }));
    const tab = selectedTabs.filter( t => t.active )[0];

    for(const t of selectedTabs) {
        tab2top.set(t.id, tab.id);
    }

    notify(extname, 'Tabs stacked');
    toggleStackStatus(tab);
}

// param tab: currently active Tab
// can be a host, a guest or undefined
async function toggleStackStatus(activTab) {

    /* when the disable works correctly this is not necessary */
    if(!isStacked(activTab.id)){
        notify(extname, 'tab is not part of a stack');
        return;
    }
    /**/

    let topTab;

    if(isTop(activTab.id)){

        topTab = activTab;

        // focus top
        browser.tabs.highlight({tabs: [topTab.index]});
        // figure out if we need to hide or show the guests

        let first = true;
        let show = false;

        let tmp = [];
        for(const [k,v] of tab2top){
            // for all but the top
            if(v === topTab.id && k !== v){
                // determine if show or hide
                if(first){
                    first = false;
                    show = (await browser.tabs.get(k)).hidden;
                    // move host tab to front or back
                    if(show){
                        await browser.tabs.move(topTab.id, {index: -1});
                        tmp.push(topTab.id);
                    }else{
                        //await browser.tabs.move(topTab.id, {index:  0});
                        browser.tabs.update(topTab.id, { pinned: true, active: true, highlighted: true});
                    }
                }
                tmp.push(k);
            }
        }
        if(show){
            browser.tabs.update(topTab.id, { pinned: false, active: true, highlighted: true});
            browser.tabs.move(topTab.id, {index: -1});
            browser.tabs.move(tmp, {index: -1});
            browser.tabs.show(tmp);
        }else{
            browser.tabs.hide(tmp);
            // keep the tabs into an aligend postion
            // when the stack gets removed
            browser.tabs.move(tmp, {index:  0});
        }
        onTabActivated({tabId: topTab.id, windowId: activTab.windowId});
    }else { // is stacked
        setTop(activTab.id);
        toggleStackStatus(activTab);
    }
}

function onTabActivated(activeInfo) {
    if(isStacked(activeInfo.tabId)){
        browser.browserAction.enable(activeInfo.tabId);
        if(isTop(activeInfo.tabId)){
            browser.windows.update(activeInfo.windowId, {titlePreface: 'Stack Top  :: '});
        }else{
            browser.windows.update(activeInfo.windowId, {titlePreface: 'Stack Sub :: '});
        }
    }else{
        browser.browserAction.disable(activeInfo.tabId);
        browser.windows.update(activeInfo.windowId, {titlePreface: ''});
    }
}

function notify(title, message = "", iconUrl = "icon.png") {
    return browser.notifications.create(""+Date.now(),{
           "type": "basic"
            ,iconUrl
            ,title
            ,message
    });
}

function onTabRemoved(tabId /*, removeInfo */) {
    let tmp = [];
    if(isTop(tabId)){
        for(const [k,v] of tab2top){
            if( v === tabId ){
                tab2top.delete(k);
                tmp.push(k);
            }
        }
        browser.tabs.show(tmp);
        notify(extname, 'Unstack (Top removed)');
    }else{ // not top
        tmp = getRest(tabId);
        if(tmp.length === 1){
            // only the host tab is left, to this stack is done for
            tab2top.delete(getTop(tabId));
            notify(extname, 'Unstack (Only Top was left)');
        }
        tab2top.delete(tabId);
    }
}

browser.menus.create({
    id: 'tabmenu1',
    title: "",
    contexts: ["tab"],
    onclick: toggleStackStatus
});

browser.menus.onShown.addListener(async (info, tab) => {
    if(isStacked(tab.id)){
        browser.menus.update('tabmenu1', {
            title: 'UnStack',
            visible: true,
            onclick: (info, tab) => { unstack(tab); }
        });
    }else if(multipleHighlighted) {
        browser.menus.update('tabmenu1', {
            title: 'Stack',
            visible: true,
            onclick: (/*info, tab*/) => { stack(); }
        });
    }else{
        browser.menus.update('tabmenu1', {
            visible: false
        });
    }
    browser.menus.refresh();
});

function onTabsHighlighted(highlightInfo) {
    multipleHighlighted = (highlightInfo.tabIds.length > 1);
}

// default state of browserAction
browser.browserAction.disable();

// register listeners
browser.browserAction.onClicked.addListener(toggleStackStatus);
browser.tabs.onActivated.addListener(onTabActivated);
browser.tabs.onRemoved.addListener(onTabRemoved);
browser.tabs.onHighlighted.addListener(onTabsHighlighted);

