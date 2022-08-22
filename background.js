/* global browser */

const manifest = browser.runtime.getManifest();
const extname = manifest.name;
const tab2top = new Map();

function isStacked(id){
    return tab2top.has(id);
}

function isTop(id){
    if(!isStacked(id)) {
        console.error('called isTop, with unstacked id');
    }
    return (id === tab2top.get(id));
}

function getTop(id){
    if(!isStacked(id)){
        console.error('called getTop, with unstacked id');
    }
    return tab2top.get(id);
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

function setFavicon(tab) {
    browser.tabs.executeScript(tab.id, {
            code: "var link = document.querySelector(\"link[rel*='icon']\") || document.createElement('link');\n" +
                "    link.type = 'image/x-icon';\n" +
                "    link.rel = 'shortcut icon';\n" +
                "    link.href = '" + browser.runtime.getURL("icon.png")  + "';\n" +
                "    document.getElementsByTagName('head')[0].appendChild(link);"
    });
}

async function unstack(){

    const activTab = (await browser.tabs.query({ currentWindow: true, active: true}))[0];

    if(isStacked(activTab.id)){

        let tmp = [];
        for(const [k,v] of tab2top){
            if( v === activTab.id){
                tmp.push(k);
                tab2top.delete(k);
            }
        }
        browser.tabs.move(tmp, {index: -1});
        browser.tabs.show(tmp);

        notify(extname, 'Unstack (menu)');
        handleActivated({tabId: activTab.id, windowId: activTab.windowId});
    }else{
        notify(extname, 'active tab not stacked, nothing to unstack');
    }
}

async function stack() {

    const selectedTabs = (await browser.tabs.query({ currentWindow: true, highlighted: true }));
    const activTab = selectedTabs.filter( t => t.active )[0];

    if(selectedTabs.length < 2){
        notify(extname, 'More than one tab required to stack');
        return;
    }

    for(const t of selectedTabs) {
        if(isStacked(t.id)){
            notify(extname, 'Double stacking not allowed. Sorry.');
            return;
        }
    }

    for(const t of selectedTabs) {
        tab2top.set(t.id, activTab.id);
    }

    notify(extname, 'Tabs stacked');

    toggleStack(activTab);

}


// param tab: currently active Tab
// can be a host, a guest or undefined
async function toggleStack(activTab) {

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
            //browser.tabs.move(topTab.id, {index: -1});
            browser.tabs.move(tmp, {index: -1});
            browser.tabs.show(tmp);
        }else{
            browser.tabs.hide(tmp);
            // keep the tabs into an aligend postion
            // when the stack gets removed
            browser.tabs.move(tmp, {index:  0});


        }
    }else{ // not a host
        topTab = await browser.tabs.get(getTop(activTab.id));
        await browser.tabs.highlight({tabs: [topTab.index]});

        browser.tabs.move(topTab.id, {index: 0});
        // hide all guests
        const tmp = getRest(topTab.id);
        browser.tabs.hide(tmp);
        browser.tabs.move(tmp, {index:  0});
    }
    setFavicon(topTab);
    handleActivated({tabId: topTab.id, windowId: activTab.windowId});
}


function handleActivated(activeInfo) {
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
    return browser.notifications.create(""+Date.now(),
        {
           "type": "basic"
            ,iconUrl
            ,title
            ,message
        }
    );
}

function handleRemoved(tabId /*, removeInfo */) {
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
        console.log('rest', tmp.length);
        if(tmp.length === 1){
            // only the host tab is left, to this stack is done for
            tab2top.delete(getTop(tabId));
            notify(extname, 'Unstack (Only Top was left)');
        }
        tab2top.delete(tabId);
    }
}

function onTabUpdated(tabId, changeInfo, tab){
    console.log('onTabUpdated');

    if(isTop(tabId) && tab.status === 'complete'){
        setFavicon(tab);
    }

}

browser.browserAction.disable();

browser.menus.create({ id: 'toggleStack', title: "",  contexts: ["tab"], onclick: toggleStack});

browser.menus.onShown.addListener(async (/*info, tab*/) => {
  //let menuInstanceId = nextMenuInstanceId++;
  //lastMenuInstanceId = menuInstanceId;

  const activTab = (await browser.tabs.query({ currentWindow: true, active: true}))[0];
  const selectedTabs = (await browser.tabs.query({ currentWindow: true, highlighted: true}));
    if(isStacked(activTab.id)){
        browser.menus.update('toggleStack', {
        title: 'UnStack',
        visible: true,
        onclick: unstack
        });
  browser.menus.refresh();

    }else if(selectedTabs.length > 1) {
        browser.menus.update('toggleStack', {
        title: 'Stack',
        visible: true,
        onclick: stack
        });
  browser.menus.refresh();
    }else{
        browser.menus.update('toggleStack', {
        visible: false
        });
  // must now perform the check
  browser.menus.refresh();
    }
});

browser.browserAction.onClicked.addListener(toggleStack);
browser.tabs.onActivated.addListener(handleActivated);
browser.tabs.onRemoved.addListener(handleRemoved);

browser.tabs.onUpdated.addListener(onTabUpdated, { properties: ["status"] } );
