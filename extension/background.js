// Clicking the toolbar icon opens the side panel, which runs the on-device model.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(error=>console.error('Kindifier could not set the side panel behavior',error));
