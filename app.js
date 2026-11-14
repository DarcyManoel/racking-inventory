let state = null

let viewState = {
	tab: `overview`,
	roomIndex: 0,
	rackIndex: 0,
	openLocation: null,
	message: ``,
	loadWarning: ``,
	saveFailed: false,
	copyLabel: `Copy stock`,
	rackScrollPositions: {},
	switchScrollPositions: {}
}

// Escapes user-entered names and batch codes so they cannot break the page markup.
let makeSafeForHtml = (text) => String(text).replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`).replace(/"/g, `&quot;`)

let makeSwatchHtml = (product) => `<span class="swatch ${determineProductColour(product) || `none`}"></span>`

let makeColourOptionsHtml = (selectedColour) => productColourRows.map(([value, label]) => `<option value="${value}"${value === (selectedColour || ``) ? ` selected` : ``}>${label}</option>`).join(``)

let commitChange = (message) => {
	viewState.saveFailed = !saveState(state).isOk
	viewState.message = message || ``
	render()
}

let handleResult = (result) => commitChange(result.isOk ? `` : result.message)

let renderMessage = () => viewState.message === `` ? `` : `<p class="message">${makeSafeForHtml(viewState.message)}</p>`

// The overview cell: each product name with its batches indented beneath. The tone class sets the colours. An unavailable location is drawn as an empty gap so the other spaces keep their positions. fitSpaceCell trims whatever does not fit.
let renderSpaceCell = (roomIndex, rackIndex, spaceIndex) => {
	let location = makeLocation(roomIndex, rackIndex, spaceIndex)
	let space = getSpace(state, location)

	if (space.isUnavailable === true) return `<span class="space-gap"></span>`

	let lines = space.entries.map(entry => {
		let batchLines = entry.batches.length === 0 ? `<span class="space-line batch uncounted">not counted</span>` : entry.batches.map(batch => `<span class="space-line batch">${makeSafeForHtml(batch.code)} \u00D7 ${batch.boxCount}</span>`).join(``)

		return `<span class="space-line product">${makeSafeForHtml(findProduct(state, entry.productId).name)}</span>${batchLines}`
	}).join(``)
	let stateClass = determineSpaceStatus(space) === `empty` ? `empty` : space.isUnfinished === true ? `unfinished` : ``

	return `<button class="space-cell tone-${determineSpaceTone(state, space)} ${stateClass}" onclick="openSpace(${roomIndex},${rackIndex},${spaceIndex})" aria-label="${makeSpaceLabel(state, location)}"><span class="space-lines">${lines}</span></button>`
}

// Hides lines from the end until the rest fit, then ends the cell with an ellipsis line so it is clear there is more. It measures the real layout, so it runs after every render and on resize.
let fitSpaceCell = (cellElement) => {
	let linesElement = cellElement.querySelector(`.space-lines`)

	if (linesElement === null) return

	let lineElements = [...linesElement.querySelectorAll(`.space-line`)]
	let isOverflowing = () => linesElement.scrollHeight > linesElement.clientHeight

	if (!isOverflowing()) return

	let ellipsisElement = document.createElement(`span`)

	ellipsisElement.className = `space-line more`
	ellipsisElement.textContent = `\u2026`
	linesElement.append(ellipsisElement)

	while (isOverflowing() && lineElements.length > 0) lineElements.pop().remove()
}

// Shows a fade on each side of a rack that has more locations beyond the visible window.
let updateRackFades = (scrollElement) => {
	let windowElement = scrollElement.parentElement

	windowElement.classList.toggle(`can-scroll-left`, scrollElement.scrollLeft > 1)
	windowElement.classList.toggle(`can-scroll-right`, scrollElement.scrollLeft + scrollElement.clientWidth < scrollElement.scrollWidth - 1)
	windowElement.classList.toggle(`can-scroll-up`, scrollElement.scrollTop > 1)
	windowElement.classList.toggle(`can-scroll-down`, scrollElement.scrollTop + scrollElement.clientHeight < scrollElement.scrollHeight - 1)
}

let handleRackScroll = (scrollElement, roomIndex, rackIndex) => {
	viewState.rackScrollPositions[`${roomIndex}-${rackIndex}`] = {
		left: scrollElement.scrollLeft,
		top: scrollElement.scrollTop
	}
	updateRackFades(scrollElement)
}

// Puts each rack back where it was scrolled to after a re-render. A rack not scrolled yet starts at the floor, so the lowest levels show first and the fade at the top shows there are more above.
let restoreRackScrolls = () => document.querySelectorAll(`.rack-scroll`).forEach(scrollElement => {
	let savedPosition = viewState.rackScrollPositions[`${scrollElement.dataset.roomIndex}-${scrollElement.dataset.rackIndex}`]

	scrollElement.scrollLeft = savedPosition ? savedPosition.left : 0
	scrollElement.scrollTop = savedPosition ? savedPosition.top : scrollElement.scrollHeight
	updateRackFades(scrollElement)
})

let handleSwitchScroll = (switchElement) => {
	viewState.switchScrollPositions[switchElement.dataset.switchName] = switchElement.scrollLeft
}

// Puts the room and rack selectors back where they were scrolled to after a re-render, then scrolls just far enough to keep the selected button in view.
let restoreSwitchScrolls = () => document.querySelectorAll(`.room-switch, .rack-switch`).forEach(switchElement => {
	let selectedButton = switchElement.querySelector(`button.selected`)

	switchElement.scrollLeft = viewState.switchScrollPositions[switchElement.dataset.switchName] || 0

	if (selectedButton !== null && selectedButton.offsetLeft < switchElement.scrollLeft) switchElement.scrollLeft = selectedButton.offsetLeft
	else if (selectedButton !== null && selectedButton.offsetLeft + selectedButton.offsetWidth > switchElement.scrollLeft + switchElement.clientWidth) switchElement.scrollLeft = selectedButton.offsetLeft + selectedButton.offsetWidth - switchElement.clientWidth

	viewState.switchScrollPositions[switchElement.dataset.switchName] = switchElement.scrollLeft
})

let renderRack = (roomIndex, rackIndex) => {
	let rack = state.rooms[roomIndex].racks[rackIndex]
	let cells = ``

	for (let levelIndex = rack.levelCount - 1; levelIndex >= 0; levelIndex--) {
		for (let bayIndex = 0; bayIndex < rack.bayCount; bayIndex++) cells += renderSpaceCell(roomIndex, rackIndex, levelIndex * rack.bayCount + bayIndex)
	}

	return `<section class="rack ${rackIndex === viewState.rackIndex ? `selected` : ``}" style="--rack-bays:${rack.bayCount};--stand-levels:${defaultLevelCount};--window-bays:${Math.min(rack.bayCount, defaultBayCount)};--window-levels:${Math.min(rack.levelCount, defaultLevelCount)}"><h2>${makeSafeForHtml(rack.name)}</h2><div class="rack-stand"><div class="rack-window"><div class="rack-scroll" data-room-index="${roomIndex}" data-rack-index="${rackIndex}" onscroll="handleRackScroll(this,${roomIndex},${rackIndex})"><div class="rack-grid">${cells}</div></div><span class="rack-fade left"></span><span class="rack-fade right"></span><span class="rack-fade top"></span><span class="rack-fade bottom"></span></div></div></section>`
}

// The floor of a room: its floor spaces in order, then a tile that adds another. Floor spaces are the same size as rack locations and wrap onto new rows.
let renderFloor = (roomIndex) => {
	let cells = state.rooms[roomIndex].floorSpaces.map((space, spaceIndex) => renderSpaceCell(roomIndex, floorAreaIndex, spaceIndex)).join(``)

	return `<section class="floor"><h2>Floor</h2><div class="floor-grid">${cells}<button class="space-cell empty add-tile" onclick="addFloorSpaceToRoom(${roomIndex})" aria-label="Add floor space">+ Add floor space</button></div></section>`
}

let renderOverviewTab = () => {
	let room = state.rooms[viewState.roomIndex]
	let roomButtons = state.rooms.map((otherRoom, roomIndex) => `<button class="${roomIndex === viewState.roomIndex ? `selected` : ``}" onclick="switchRoom(${roomIndex})">${makeSafeForHtml(otherRoom.name)}</button>`).join(``)
	let roomSwitch = state.rooms.length > 1 ? `<div class="room-switch" data-switch-name="room" onscroll="handleSwitchScroll(this)">${roomButtons}</div>` : ``
	let rackButtons = room.racks.map((rack, rackIndex) => `<button class="${rackIndex === viewState.rackIndex ? `selected` : ``}" onclick="switchRack(${rackIndex})">${makeSafeForHtml(rack.name)}</button>`).join(``)
	let rackSwitch = `<div class="rack-switch" data-switch-name="rack" onscroll="handleSwitchScroll(this)">${rackButtons === `` ? `<button disabled>No racks</button>` : rackButtons}</div>`
	let hint = state.products.length === 0 ? `<p class="message">Add your products on the Products tab, then tap a space to fill it.</p>` : ``
	let racks = room.racks.map((rack, rackIndex) => renderRack(viewState.roomIndex, rackIndex)).join(``)
	let rackList = room.racks.length === 0 ? `<p class="note">This room has no racks. Add one on the Rooms tab, or use the floor below.</p>` : `<div class="rack-list">${racks}</div>`

	return `${hint}${roomSwitch}${rackSwitch}${rackList}${renderFloor(viewState.roomIndex)}`
}

// Products with stock come first, then a separate section for products in no space.
let renderStockTab = () => {
	let summaries = summariseStock(state)
	let stockedHtml = summaries.filter(hasStock).map(entry => {
		let locations = entry.locations.map(location => `<li><strong>${makeSafeForHtml(location.label)}</strong><span${location.batches.length === 0 ? ` class="uncounted"` : ``}>${location.batches.length === 0 ? `not counted` : location.batches.map(batch => `${makeSafeForHtml(batch.code)} \u00D7 ${batch.boxCount}`).join(`, `)}</span></li>`).join(``)
		let uncounted = entry.uncountedSpaceCount > 0 ? `<p class="note uncounted">${makeSpaceCountText(entry.uncountedSpaceCount)} ${entry.uncountedSpaceCount === 1 ? `holds` : `hold`} this product with boxes not counted, so the total is a minimum.</p>` : ``

		return `<article class="stock-entry"><h2>${makeSwatchHtml(entry.product)}${makeSafeForHtml(entry.product.name)}</h2><p class="stock-total">${makeBoxCountText(entry.totalBoxes)}</p>${uncounted}<ul>${locations}</ul></article>`
	}).join(``)
	let unstocked = summaries.filter(summary => !hasStock(summary))
	let unstockedHtml = unstocked.length === 0 ? `` : `<h2 class="stock-section">No stock</h2>` + unstocked.map(entry => `<article class="stock-entry"><h2>${makeSwatchHtml(entry.product)}${makeSafeForHtml(entry.product.name)}</h2><p class="note">Not in any space.</p></article>`).join(``)

	return stockedHtml + unstockedHtml === `` ? `<p class="message">No products yet. Add them on the Products tab.</p>` : stockedHtml + unstockedHtml
}

let renderProductsTab = () => {
	let rows = state.products.map(product => `<li><span>${makeSwatchHtml(product)}${makeSafeForHtml(product.name)}</span><select onchange="chooseProductColour(${product.id},this.value)" aria-label="Colour">${makeColourOptionsHtml(product.colour)}</select><button onclick="renameProductPrompt(${product.id})">Rename</button><button class="danger" onclick="removeProductConfirm(${product.id})">Remove</button></li>`).join(``)

	return `${renderMessage()}<form class="add-row" onsubmit="submitProduct();return false"><input id="product-name-input" placeholder="New product name" autocomplete="off"><select id="product-colour-input" aria-label="Colour">${makeColourOptionsHtml(``)}</select><button class="primary">Add</button></form><ul class="item-list">${rows}</ul><h2>Backup</h2><p class="note">Data lives only in this browser on this device. Export a copy now and then, and keep it somewhere safe.</p><div class="add-row"><button onclick="exportBackup()">Export backup</button><label class="button">Import backup<input type="file" accept="application/json" onchange="importBackup(event)" hidden></label></div>`
}

// Each room with its racks (rename, remove, restore unavailable locations) and a form to add a rack, then a form to add a room.
let renderRoomsTab = () => {
	let roomBlocks = state.rooms.map((room, roomIndex) => {
		let rackRows = room.racks.map((rack, rackIndex) => {
			let restoreItems = rack.spaces.map((space, spaceIndex) => space.isUnavailable === true ? `<li><span>Level ${Math.floor(spaceIndex / rack.bayCount) + 1}, bay ${(spaceIndex % rack.bayCount) + 1}</span><button onclick="restoreLocation(${roomIndex},${rackIndex},${spaceIndex})">Restore</button></li>` : ``).join(``)
			let unavailable = restoreItems === `` ? `` : `<div class="unavailable-locations"><span class="note">Unavailable locations</span><ul>${restoreItems}</ul></div>`

			return `<li><span><strong>${makeSafeForHtml(rack.name)}</strong> <span class="note">${rack.bayCount} bays \u00D7 ${rack.levelCount} levels</span></span><button onclick="renameRackPrompt(${roomIndex},${rackIndex})">Rename</button><button class="danger" onclick="removeRackConfirm(${roomIndex},${rackIndex})">Remove</button>${unavailable}</li>`
		}).join(``)
		let rackList = room.racks.length === 0 ? `<p class="note">No racks in this room yet.</p>` : `<ul class="item-list">${rackRows}</ul>`

		return `<section class="room-block"><div class="room-header"><h2>${makeSafeForHtml(room.name)}</h2><button onclick="renameRoomPrompt(${roomIndex})">Rename</button><button class="danger" onclick="removeRoomConfirm(${roomIndex})">Remove</button></div><p class="note">${makeSpaceCountText(room.floorSpaces.length)} on the floor.</p>${rackList}<h3>Add a rack to ${makeSafeForHtml(room.name)}</h3><form class="add-rack-form" onsubmit="submitRack(${roomIndex});return false"><input id="rack-name-input-${roomIndex}" value="${makeSafeForHtml(suggestRackName(room))}" aria-label="Rack name" autocomplete="off"><label>Bays across<input id="rack-bays-input-${roomIndex}" type="number" inputmode="numeric" min="1" max="${maxRackSideCount}" value="${defaultBayCount}"></label><label>Levels high<input id="rack-levels-input-${roomIndex}" type="number" inputmode="numeric" min="1" max="${maxRackSideCount}" value="${defaultLevelCount}"></label><button class="primary">Add rack</button></form></section>`
	}).join(``)

	return `${renderMessage()}${roomBlocks}<h2>Add a room</h2><form class="add-row" onsubmit="submitRoom();return false"><input id="room-name-input" value="${makeSafeForHtml(suggestRoomName(state))}" aria-label="Room name" autocomplete="off"><button class="primary">Add room</button></form><p class="note">A rack's size is set when it is added and cannot be changed later. Levels are numbered from the floor up. Racks and rooms can only be removed when they hold no products. Floor spaces are added and removed on the Overview tab.</p>`
}

let renderSheet = () => {
	let location = viewState.openLocation

	if (location === null) return ``

	let isFloor = isFloorLocation(location)
	let space = getSpace(state, location)
	let entryBlocks = space.entries.map(entry => {
		let batchRows = entry.batches.map((batch, batchIndex) => `<li class="batch-row"><span class="batch-code">${makeSafeForHtml(batch.code)}</span><button onclick="nudgeBatch(${entry.productId},${batchIndex},-1)" aria-label="Remove one box">\u2212</button><span class="batch-count">${batch.boxCount}</span><button onclick="nudgeBatch(${entry.productId},${batchIndex},1)" aria-label="Add one box">+</button><button class="danger" onclick="removeBatch(${entry.productId},${batchIndex})" aria-label="Delete batch">\u2715</button></li>`).join(``)
		let uncounted = entry.batches.length === 0 ? `<p class="note">No batches yet, so the box count is unknown.</p>` : ``

		return `<section class="entry-block"><div class="entry-header"><h3>${makeSwatchHtml(findProduct(state, entry.productId))}${makeSafeForHtml(findProduct(state, entry.productId).name)}</h3><button class="danger" onclick="removeEntryConfirm(${entry.productId})">Remove</button></div>${uncounted}<ul class="batch-list">${batchRows}</ul><form class="add-row" onsubmit="submitBatch(${entry.productId});return false"><input id="batch-code-input-${entry.productId}" placeholder="Batch code" autocomplete="off"><input id="batch-count-input-${entry.productId}" type="number" inputmode="numeric" min="1" value="1"><button class="primary">Add batch</button></form></section>`
	}).join(``)
	let availableProducts = state.products.filter(product => findEntry(space, product.id) === null)
	let options = `<option value="">Choose a product\u2026</option>` + availableProducts.map(product => `<option value="${product.id}">${makeSafeForHtml(product.name)}</option>`).join(``)
	let addProductControl = space.isUnavailable === true ? `` : availableProducts.length === 0 ? `<p class="note">${state.products.length === 0 ? `Add products on the Products tab first.` : `Every product is already in this space.`}</p>` : `<label>Add a product to this space<select onchange="addProductToSpaceChosen(this.value)">${options}</select></label>`
	let unfinishedControl = space.entries.length === 0 ? `` : `<label class="check-row"><input type="checkbox"${space.isUnfinished === true ? ` checked` : ``} onchange="toggleSpaceUnfinished(this.checked)">Unfinished pallet</label>`
	let unavailableControl = isFloor || space.entries.length > 0 ? `` : `<label class="check-row"><input type="checkbox"${space.isUnavailable === true ? ` checked` : ``} onchange="toggleSpaceUnavailable(this.checked)">Location unavailable (hides this space)</label>${space.isUnavailable === true ? `<p class="note">To bring it back later, open the Rooms tab and choose Restore.</p>` : ``}`
	let emptyButton = space.entries.length === 0 ? `` : `<button class="danger" onclick="clearSpace()">Empty this space</button>`
	let removeFloorButton = isFloor && space.entries.length === 0 ? `<button class="danger" onclick="removeFloorSpaceHere()">Remove this floor space</button>` : ``

	return `<div class="sheet-backdrop" onclick="closeSheet()"></div><div class="sheet"><div class="sheet-header"><h2>${makeSafeForHtml(makeSpaceLabel(state, location))}</h2><button onclick="closeSheet()" aria-label="Close">\u2715</button></div>${renderMessage()}${entryBlocks}${unfinishedControl}${addProductControl}${unavailableControl}${emptyButton}${removeFloorButton}</div>`
}

let render = () => {
	let sheetElement = document.querySelector(`.sheet`)
	let sheetScrollTopPx = sheetElement ? sheetElement.scrollTop : 0

	if (viewState.roomIndex >= state.rooms.length) viewState.roomIndex = 0
	if (viewState.rackIndex >= state.rooms[viewState.roomIndex].racks.length) viewState.rackIndex = 0

	let tabContent = viewState.tab === `overview` ? renderOverviewTab() : viewState.tab === `stock` ? renderStockTab() : viewState.tab === `products` ? renderProductsTab() : renderRoomsTab()
	let saveText = viewState.saveFailed ? `Not saved` : state.savedAtMillis === null ? `` : `Saved ${new Date(state.savedAtMillis).toLocaleTimeString(`en-AU`, {
		hour: `numeric`,
		minute: `2-digit`
	})}`
	let warning = viewState.loadWarning === `` ? `` : `<p class="message">${makeSafeForHtml(viewState.loadWarning)}</p>`
	let tabButtons = [[`overview`, `Overview`], [`stock`, `Stock`], [`products`, `Products`], [`rooms`, `Rooms`]].map(([tabName, tabLabel]) => `<button class="${viewState.tab === tabName ? `selected` : ``}" onclick="switchTab(\`${tabName}\`)">${tabLabel}</button>`).join(``)

	document.getElementById(`app`).innerHTML = `<header class="app-header"><h1>Racking Inventory</h1><div class="header-actions"><span class="save-status ${viewState.saveFailed ? `failed` : ``}">${saveText}</span><button id="copy-stock-button" onclick="copyStockText()">${makeSafeForHtml(viewState.copyLabel)}</button></div></header>${warning}<main>${tabContent}</main><nav class="tab-bar">${tabButtons}</nav>${renderSheet()}`

	sheetElement = document.querySelector(`.sheet`)
	if (sheetElement) sheetElement.scrollTop = sheetScrollTopPx

	restoreSwitchScrolls()
	restoreRackScrolls()
	document.querySelectorAll(`.space-cell`).forEach(fitSpaceCell)
}

let switchTab = (tabName) => {
	viewState.tab = tabName
	viewState.message = ``
	render()
}

let switchRoom = (roomIndex) => {
	viewState.roomIndex = roomIndex
	viewState.rackIndex = 0
	viewState.switchScrollPositions.rack = 0
	render()
}

let switchRack = (rackIndex) => {
	viewState.rackIndex = rackIndex
	render()
}

let openSpace = (roomIndex, rackIndex, spaceIndex) => {
	viewState.openLocation = makeLocation(roomIndex, rackIndex, spaceIndex)
	viewState.message = ``
	render()
}

let closeSheet = () => {
	viewState.openLocation = null
	viewState.message = ``
	render()
}

// Adds a floor space and opens it straight away so it can be filled in.
let addFloorSpaceToRoom = (roomIndex) => {
	let result = addFloorSpace(state, roomIndex)

	handleResult(result)
	openSpace(roomIndex, floorAreaIndex, state.rooms[roomIndex].floorSpaces.length - 1)
}

let removeFloorSpaceHere = () => {
	let result = removeFloorSpace(state, viewState.openLocation.roomIndex, viewState.openLocation.spaceIndex)

	if (result.isOk) viewState.openLocation = null

	handleResult(result)
}

let addProductToSpaceChosen = (value) => {
	if (value === ``) return

	handleResult(addProductToSpace(state, viewState.openLocation, Number(value)))
}

let toggleSpaceUnfinished = (isChecked) => handleResult(setSpaceUnfinished(state, viewState.openLocation, isChecked))

let toggleSpaceUnavailable = (isChecked) => handleResult(setSpaceUnavailable(state, viewState.openLocation, isChecked))

let restoreLocation = (roomIndex, rackIndex, spaceIndex) => handleResult(setSpaceUnavailable(state, makeLocation(roomIndex, rackIndex, spaceIndex), false))

let submitRoom = () => handleResult(addRoom(state, document.getElementById(`room-name-input`).value))

let renameRoomPrompt = (roomIndex) => {
	let newName = prompt(`New name for this room`, state.rooms[roomIndex].name)

	if (newName !== null) handleResult(renameRoom(state, roomIndex, newName))
}

let removeRoomConfirm = (roomIndex) => {
	if (!confirm(`Remove ${state.rooms[roomIndex].name}?`)) return

	let result = removeRoom(state, roomIndex)

	if (result.isOk) viewState.rackScrollPositions = {}

	handleResult(result)
}

let submitRack = (roomIndex) => handleResult(addRack(state, roomIndex, document.getElementById(`rack-name-input-${roomIndex}`).value, Number(document.getElementById(`rack-levels-input-${roomIndex}`).value), Number(document.getElementById(`rack-bays-input-${roomIndex}`).value)))

let renameRackPrompt = (roomIndex, rackIndex) => {
	let newName = prompt(`New name for this rack`, state.rooms[roomIndex].racks[rackIndex].name)

	if (newName !== null) handleResult(renameRack(state, roomIndex, rackIndex, newName))
}

let removeRackConfirm = (roomIndex, rackIndex) => {
	if (!confirm(`Remove ${state.rooms[roomIndex].racks[rackIndex].name}?`)) return

	let result = removeRack(state, roomIndex, rackIndex)

	if (result.isOk) viewState.rackScrollPositions = {}

	handleResult(result)
}

let removeEntryConfirm = (productId) => {
	let entry = findEntry(getSpace(state, viewState.openLocation), productId)

	if (entry.batches.length > 0 && !confirm(`Remove ${findProduct(state, productId).name} and its batches from this space?`)) return

	removeProductFromSpace(state, viewState.openLocation, productId)
	commitChange(``)
}

let clearSpace = () => {
	if (!confirm(`Empty this space and delete everything in it?`)) return

	emptySpace(state, viewState.openLocation)
	commitChange(``)
}

let submitBatch = (productId) => handleResult(addBatch(state, viewState.openLocation, productId, document.getElementById(`batch-code-input-${productId}`).value, Number(document.getElementById(`batch-count-input-${productId}`).value)))

let nudgeBatch = (productId, batchIndex, deltaBoxCount) => {
	adjustBatch(state, viewState.openLocation, productId, batchIndex, deltaBoxCount)
	commitChange(``)
}

let removeBatch = (productId, batchIndex) => {
	deleteBatch(state, viewState.openLocation, productId, batchIndex)
	commitChange(``)
}

let submitProduct = () => handleResult(addProduct(state, document.getElementById(`product-name-input`).value, document.getElementById(`product-colour-input`).value))

let chooseProductColour = (productId, value) => handleResult(setProductColour(state, productId, value))

let renameProductPrompt = (productId) => {
	let newName = prompt(`New name for this product`, findProduct(state, productId).name)

	if (newName !== null) handleResult(renameProduct(state, productId, newName))
}

let removeProductConfirm = (productId) => {
	if (confirm(`Remove ${findProduct(state, productId).name}?`)) handleResult(removeProduct(state, productId))
}

let exportBackup = () => {
	let blob = new Blob([JSON.stringify(state, null, 2)], {
		type: `application/json`
	})
	let link = document.createElement(`a`)

	link.href = URL.createObjectURL(blob)
	link.download = `racking-backup-${new Date().toISOString().slice(0, 10)}.json`
	link.click()
}

let importBackup = (event) => {
	let file = event.target.files[0]

	if (!file) return

	let reader = new FileReader()

	reader.onload = () => {
		try {
			let importedState = upgradeState(JSON.parse(reader.result))
			let validation = validateImportedState(importedState)

			if (!validation.isOk) return commitChange(validation.message)
			if (!confirm(`Replace everything with this backup?`)) return

			state = importedState
			viewState.rackScrollPositions = {}
			viewState.openLocation = null
			commitChange(`Backup imported.`)
		} catch (error) {
			commitChange(`That file could not be read as JSON.`)
		}
	}
	reader.readAsText(file)
}

let updateCopyButton = () => {
	let buttonElement = document.getElementById(`copy-stock-button`)

	if (buttonElement) buttonElement.textContent = viewState.copyLabel
}

// Shows the result on the button for two seconds, then puts the normal label back.
let flashCopyLabel = (labelText) => {
	viewState.copyLabel = labelText
	updateCopyButton()
	setTimeout(() => {
		viewState.copyLabel = `Copy stock`
		updateCopyButton()
	}, 2000)
}

// The older copy command through a hidden text box, used when the modern clipboard is unavailable (it needs a secure page, such as https).
let copyWithHiddenTextBox = (text) => {
	try {
		let textBox = document.createElement(`textarea`)

		textBox.value = text
		textBox.setAttribute(`readonly`, ``)
		textBox.style.opacity = `0`
		textBox.style.position = `fixed`
		document.body.append(textBox)
		textBox.select()
		textBox.setSelectionRange(0, text.length)

		let didCopy = document.execCommand(`copy`)

		textBox.remove()

		return didCopy
	} catch (error) {
		return false
	}
}

let copyStockText = () => {
	let stockText = makeStockText(state, new Date().toLocaleString(`en-AU`))
	let showResult = (didCopy) => flashCopyLabel(didCopy ? `Copied` : `Copy failed`)

	if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(stockText).then(() => showResult(true), () => showResult(copyWithHiddenTextBox(stockText)))
	else showResult(copyWithHiddenTextBox(stockText))
}

let loaded = loadState()

state = loaded.state
viewState.loadWarning = loaded.warning
render()

// Refits the overview cells when the window size or orientation changes, unless the edit sheet is open and a re-render would interrupt typing.
window.addEventListener(`resize`, () => {
	if (viewState.openLocation === null) render()
})
