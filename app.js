let state = null

let viewState = {
	tab: `overview`,
	rackIndex: 0,
	openRackIndex: null,
	openSpaceIndex: null,
	message: ``,
	loadWarning: ``,
	saveFailed: false,
	copyLabel: `Copy stock`,
	rackScrollPositions: {}
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
let renderSpaceCell = (rackIndex, spaceIndex) => {
	let space = getSpace(state, rackIndex, spaceIndex)

	if (space.isUnavailable === true) return `<span class="space-gap"></span>`

	let lines = space.entries.map(entry => {
		let batchLines = entry.batches.length === 0 ? `<span class="space-line batch uncounted">not counted</span>` : entry.batches.map(batch => `<span class="space-line batch">${makeSafeForHtml(batch.code)} \u00D7 ${batch.boxCount}</span>`).join(``)

		return `<span class="space-line product">${makeSafeForHtml(findProduct(state, entry.productId).name)}</span>${batchLines}`
	}).join(``)
	let stateClass = determineSpaceStatus(space) === `empty` ? `empty` : space.isUnfinished === true ? `unfinished` : ``

	return `<button class="space-cell tone-${determineSpaceTone(state, space)} ${stateClass}" onclick="openSpace(${rackIndex},${spaceIndex})" aria-label="${makeSpaceLabel(state, rackIndex, spaceIndex)}"><span class="space-lines">${lines}</span></button>`
}

// Hides lines from the end until the rest fit, then ends the cell with an ellipsis line so it is clear there is more. It measures the real layout, so it runs after every render and on resize.
let fitSpaceCell = (cellElement) => {
	let linesElement = cellElement.querySelector(`.space-lines`)
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

let handleRackScroll = (scrollElement, rackIndex) => {
	viewState.rackScrollPositions[rackIndex] = {
		left: scrollElement.scrollLeft,
		top: scrollElement.scrollTop
	}
	updateRackFades(scrollElement)
}

// Puts each rack back where it was scrolled to after a re-render. A rack not scrolled yet starts at the floor, so the lowest levels show first and the fade at the top shows there are more above.
let restoreRackScrolls = () => document.querySelectorAll(`.rack-scroll`).forEach(scrollElement => {
	let savedPosition = viewState.rackScrollPositions[Number(scrollElement.dataset.rackIndex)]

	scrollElement.scrollLeft = savedPosition ? savedPosition.left : 0
	scrollElement.scrollTop = savedPosition ? savedPosition.top : scrollElement.scrollHeight
	updateRackFades(scrollElement)
})

let renderRack = (rackIndex) => {
	let rack = state.racks[rackIndex]
	let cells = ``

	for (let levelIndex = rack.levelCount - 1; levelIndex >= 0; levelIndex--) {
		for (let bayIndex = 0; bayIndex < rack.bayCount; bayIndex++) cells += renderSpaceCell(rackIndex, levelIndex * rack.bayCount + bayIndex)
	}

	return `<section class="rack ${rackIndex === viewState.rackIndex ? `selected` : ``}" style="--rack-bays:${rack.bayCount};--window-bays:${Math.min(rack.bayCount, defaultBayCount)};--window-levels:${Math.min(rack.levelCount, defaultLevelCount)}"><h2>${makeSafeForHtml(rack.name)}</h2><div class="rack-window"><div class="rack-scroll" data-rack-index="${rackIndex}" onscroll="handleRackScroll(this,${rackIndex})"><div class="rack-grid">${cells}</div></div><span class="rack-fade left"></span><span class="rack-fade right"></span><span class="rack-fade top"></span><span class="rack-fade bottom"></span></div></section>`
}

let renderOverviewTab = () => {
	let switchButtons = state.racks.map((rack, rackIndex) => `<button class="${rackIndex === viewState.rackIndex ? `selected` : ``}" onclick="switchRack(${rackIndex})">${makeSafeForHtml(rack.name)}</button>`).join(``)
	let rackSwitch = state.racks.length > 1 ? `<div class="rack-switch">${switchButtons}</div>` : ``
	let hint = state.products.length === 0 ? `<p class="message">Add your products on the Products tab, then tap a space to fill it.</p>` : ``
	let racks = state.racks.map((rack, rackIndex) => renderRack(rackIndex)).join(``)

	return `${hint}${rackSwitch}<div class="rack-list">${racks}</div>`
}

// Products with stock come first, then a separate section for products in no space.
let renderStockTab = () => {
	let summaries = summariseStock(state)
	let stockedHtml = summaries.filter(hasStock).map(entry => {
		let locations = entry.locations.map(location => `<li><strong>${location.label}</strong><span${location.batches.length === 0 ? ` class="uncounted"` : ``}>${location.batches.length === 0 ? `not counted` : location.batches.map(batch => `${makeSafeForHtml(batch.code)} \u00D7 ${batch.boxCount}`).join(`, `)}</span></li>`).join(``)
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

let renderRacksTab = () => {
	let rows = state.racks.map((rack, rackIndex) => {
		let restoreItems = rack.spaces.map((space, spaceIndex) => space.isUnavailable === true ? `<li><span>Level ${Math.floor(spaceIndex / rack.bayCount) + 1}, bay ${(spaceIndex % rack.bayCount) + 1}</span><button onclick="restoreLocation(${rackIndex},${spaceIndex})">Restore</button></li>` : ``).join(``)
		let unavailable = restoreItems === `` ? `` : `<div class="unavailable-locations"><span class="note">Unavailable locations</span><ul>${restoreItems}</ul></div>`

		return `<li><span><strong>${makeSafeForHtml(rack.name)}</strong> <span class="note">${rack.bayCount} bays \u00D7 ${rack.levelCount} levels</span></span><button onclick="renameRackPrompt(${rackIndex})">Rename</button><button class="danger" onclick="removeRackConfirm(${rackIndex})">Remove</button>${unavailable}</li>`
	}).join(``)

	return `${renderMessage()}<ul class="item-list">${rows}</ul><h2>Add a rack</h2><form class="add-rack-form" onsubmit="submitRack();return false"><input id="rack-name-input" value="${makeSafeForHtml(suggestRackName(state))}" aria-label="Rack name" autocomplete="off"><label>Bays across<input id="rack-bays-input" type="number" inputmode="numeric" min="1" max="${maxRackSideCount}" value="${defaultBayCount}"></label><label>Levels high<input id="rack-levels-input" type="number" inputmode="numeric" min="1" max="${maxRackSideCount}" value="${defaultLevelCount}"></label><button class="primary">Add rack</button></form><p class="note">A rack's size is set when it is added and cannot be changed later. Levels are numbered from the floor up. A rack can only be removed when it holds no products.</p>`
}

let renderSheet = () => {
	if (viewState.openRackIndex === null) return ``

	let space = getSpace(state, viewState.openRackIndex, viewState.openSpaceIndex)
	let entryBlocks = space.entries.map(entry => {
		let batchRows = entry.batches.map((batch, batchIndex) => `<li class="batch-row"><span class="batch-code">${makeSafeForHtml(batch.code)}</span><button onclick="nudgeBatch(${entry.productId},${batchIndex},-1)" aria-label="Remove one box">\u2212</button><span class="batch-count">${batch.boxCount}</span><button onclick="nudgeBatch(${entry.productId},${batchIndex},1)" aria-label="Add one box">+</button><button class="danger" onclick="removeBatch(${entry.productId},${batchIndex})" aria-label="Delete batch">\u2715</button></li>`).join(``)
		let uncounted = entry.batches.length === 0 ? `<p class="note">No batches yet, so the box count is unknown.</p>` : ``

		return `<section class="entry-block"><div class="entry-header"><h3>${makeSwatchHtml(findProduct(state, entry.productId))}${makeSafeForHtml(findProduct(state, entry.productId).name)}</h3><button class="danger" onclick="removeEntryConfirm(${entry.productId})">Remove</button></div>${uncounted}<ul class="batch-list">${batchRows}</ul><form class="add-row" onsubmit="submitBatch(${entry.productId});return false"><input id="batch-code-input-${entry.productId}" placeholder="Batch code" autocomplete="off"><input id="batch-count-input-${entry.productId}" type="number" inputmode="numeric" min="1" value="1"><button class="primary">Add batch</button></form></section>`
	}).join(``)
	let availableProducts = state.products.filter(product => findEntry(space, product.id) === null)
	let options = `<option value="">Choose a product\u2026</option>` + availableProducts.map(product => `<option value="${product.id}">${makeSafeForHtml(product.name)}</option>`).join(``)
	let addProductControl = space.isUnavailable === true ? `` : availableProducts.length === 0 ? `<p class="note">${state.products.length === 0 ? `Add products on the Products tab first.` : `Every product is already in this space.`}</p>` : `<label>Add a product to this space<select onchange="addProductToSpaceChosen(this.value)">${options}</select></label>`
	let unfinishedControl = space.entries.length === 0 ? `` : `<label class="check-row"><input type="checkbox"${space.isUnfinished === true ? ` checked` : ``} onchange="toggleSpaceUnfinished(this.checked)">Unfinished pallet</label>`
	let unavailableControl = space.entries.length > 0 ? `` : `<label class="check-row"><input type="checkbox"${space.isUnavailable === true ? ` checked` : ``} onchange="toggleSpaceUnavailable(this.checked)">Location unavailable (hides this space)</label>${space.isUnavailable === true ? `<p class="note">To bring it back later, open the Racks tab and choose Restore.</p>` : ``}`
	let emptyButton = space.entries.length === 0 ? `` : `<button class="danger" onclick="clearSpace()">Empty this space</button>`

	return `<div class="sheet-backdrop" onclick="closeSheet()"></div><div class="sheet"><div class="sheet-header"><h2>${makeSpaceLabel(state, viewState.openRackIndex, viewState.openSpaceIndex)}</h2><button onclick="closeSheet()" aria-label="Close">\u2715</button></div>${renderMessage()}${entryBlocks}${unfinishedControl}${addProductControl}${unavailableControl}${emptyButton}</div>`
}

let render = () => {
	let sheetElement = document.querySelector(`.sheet`)
	let sheetScrollTopPx = sheetElement ? sheetElement.scrollTop : 0
	if (viewState.rackIndex >= state.racks.length) viewState.rackIndex = 0

	let tabContent = viewState.tab === `overview` ? renderOverviewTab() : viewState.tab === `stock` ? renderStockTab() : viewState.tab === `products` ? renderProductsTab() : renderRacksTab()
	let saveText = viewState.saveFailed ? `Not saved` : state.savedAtMillis === null ? `` : `Saved ${new Date(state.savedAtMillis).toLocaleTimeString(`en-AU`, {
		hour: `numeric`,
		minute: `2-digit`
	})}`
	let warning = viewState.loadWarning === `` ? `` : `<p class="message">${makeSafeForHtml(viewState.loadWarning)}</p>`
	let tabButtons = [[`overview`, `Overview`], [`stock`, `Stock`], [`products`, `Products`], [`racks`, `Racks`]].map(([tabName, tabLabel]) => `<button class="${viewState.tab === tabName ? `selected` : ``}" onclick="switchTab(\`${tabName}\`)">${tabLabel}</button>`).join(``)

	document.getElementById(`app`).innerHTML = `<header class="app-header"><h1>Racking Inventory</h1><div class="header-actions"><span class="save-status ${viewState.saveFailed ? `failed` : ``}">${saveText}</span><button id="copy-stock-button" onclick="copyStockText()">${makeSafeForHtml(viewState.copyLabel)}</button></div></header>${warning}<main>${tabContent}</main><nav class="tab-bar">${tabButtons}</nav>${renderSheet()}`

	sheetElement = document.querySelector(`.sheet`)
	if (sheetElement) sheetElement.scrollTop = sheetScrollTopPx

	restoreRackScrolls()
	document.querySelectorAll(`.space-cell`).forEach(fitSpaceCell)
}

let switchTab = (tabName) => {
	viewState.tab = tabName
	viewState.message = ``
	render()
}

let switchRack = (rackIndex) => {
	viewState.rackIndex = rackIndex
	render()
}

let openSpace = (rackIndex, spaceIndex) => {
	viewState.openRackIndex = rackIndex
	viewState.openSpaceIndex = spaceIndex
	viewState.message = ``
	render()
}

let closeSheet = () => {
	viewState.openRackIndex = null
	viewState.openSpaceIndex = null
	viewState.message = ``
	render()
}

let addProductToSpaceChosen = (value) => {
	if (value === ``) return

	handleResult(addProductToSpace(state, viewState.openRackIndex, viewState.openSpaceIndex, Number(value)))
}

let toggleSpaceUnfinished = (isChecked) => handleResult(setSpaceUnfinished(state, viewState.openRackIndex, viewState.openSpaceIndex, isChecked))

let toggleSpaceUnavailable = (isChecked) => handleResult(setSpaceUnavailable(state, viewState.openRackIndex, viewState.openSpaceIndex, isChecked))

let restoreLocation = (rackIndex, spaceIndex) => handleResult(setSpaceUnavailable(state, rackIndex, spaceIndex, false))

let submitRack = () => handleResult(addRack(state, document.getElementById(`rack-name-input`).value, Number(document.getElementById(`rack-levels-input`).value), Number(document.getElementById(`rack-bays-input`).value)))

let renameRackPrompt = (rackIndex) => {
	let newName = prompt(`New name for this rack`, state.racks[rackIndex].name)

	if (newName !== null) handleResult(renameRack(state, rackIndex, newName))
}

let removeRackConfirm = (rackIndex) => {
	if (!confirm(`Remove ${state.racks[rackIndex].name}?`)) return

	let result = removeRack(state, rackIndex)

	if (result.isOk) viewState.rackScrollPositions = {}

	handleResult(result)
}

let removeEntryConfirm = (productId) => {
	let entry = findEntry(getSpace(state, viewState.openRackIndex, viewState.openSpaceIndex), productId)

	if (entry.batches.length > 0 && !confirm(`Remove ${findProduct(state, productId).name} and its batches from this space?`)) return

	removeProductFromSpace(state, viewState.openRackIndex, viewState.openSpaceIndex, productId)
	commitChange(``)
}

let clearSpace = () => {
	if (!confirm(`Empty this space and delete everything in it?`)) return

	emptySpace(state, viewState.openRackIndex, viewState.openSpaceIndex)
	commitChange(``)
}

let submitBatch = (productId) => handleResult(addBatch(state, viewState.openRackIndex, viewState.openSpaceIndex, productId, document.getElementById(`batch-code-input-${productId}`).value, Number(document.getElementById(`batch-count-input-${productId}`).value)))

let nudgeBatch = (productId, batchIndex, deltaBoxCount) => {
	adjustBatch(state, viewState.openRackIndex, viewState.openSpaceIndex, productId, batchIndex, deltaBoxCount)
	commitChange(``)
}

let removeBatch = (productId, batchIndex) => {
	deleteBatch(state, viewState.openRackIndex, viewState.openSpaceIndex, productId, batchIndex)
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
	if (viewState.openRackIndex === null) render()
})
