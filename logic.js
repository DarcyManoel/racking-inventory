let makeResult = (isOk, message) => {
	return {
		isOk: isOk,
		message: message
	}
}

let makeSpace = () => {
	return {
		entries: [],
		isUnfinished: false,
		isUnavailable: false
	}
}

let makeRack = (name, levelCount, bayCount) => {
	let spaces = []

	for (let spaceIndex = 0; spaceIndex < levelCount * bayCount; spaceIndex++) spaces.push(makeSpace())

	return {
		name: name,
		levelCount: levelCount,
		bayCount: bayCount,
		spaces: spaces
	}
}

// A room has racks and a floor. Floor spaces are a growable list of pallet spots that work like rack spaces.
let makeRoom = (name, racks) => {
	return {
		name: name,
		racks: racks,
		floorSpaces: []
	}
}

// Builds an empty inventory with one room holding one default rack. A space holds a list of entries, one per product, each with its own batches.
let makeEmptyState = () => {
	return {
		version: storageVersion,
		nextProductId: 1,
		products: [],
		rooms: [makeRoom(`Room 1`, [makeRack(`Rack 1`, defaultLevelCount, defaultBayCount)])],
		savedAtMillis: null
	}
}

// A location says where a space is: a room, a rack (or floorAreaIndex for the floor) and the space number in it.
let makeLocation = (roomIndex, rackIndex, spaceIndex) => {
	return {
		roomIndex: roomIndex,
		rackIndex: rackIndex,
		spaceIndex: spaceIndex
	}
}

let isFloorLocation = (location) => location.rackIndex === floorAreaIndex

let getSpace = (state, location) => isFloorLocation(location) ? state.rooms[location.roomIndex].floorSpaces[location.spaceIndex] : state.rooms[location.roomIndex].racks[location.rackIndex].spaces[location.spaceIndex]

// Calls the callback with every space in every room, rack spaces first and then floor spaces, together with its location.
let forEachSpace = (state, callback) => state.rooms.forEach((room, roomIndex) => {
	room.racks.forEach((rack, rackIndex) => rack.spaces.forEach((space, spaceIndex) => callback(space, makeLocation(roomIndex, rackIndex, spaceIndex))))
	room.floorSpaces.forEach((space, spaceIndex) => callback(space, makeLocation(roomIndex, floorAreaIndex, spaceIndex)))
})

// Brings older saved data up to the current layout. Version 1 spaces held one product (productId plus batches), version 2 spaces hold a list of entries, version 3 racks have a name and their own size, and version 4 puts the racks into rooms. Versions 1 and 2 always had two unnamed racks of 4 levels and 4 bays, and older racks all go into one room named Room 1. Anything else is returned unchanged for the validator to judge.
let upgradeState = (data) => {
	if (!data || typeof data !== `object` || !Array.isArray(data.racks)) return data

	if (data.version === 1) {
		data.racks.forEach(rack => {
			if (!rack || !Array.isArray(rack.spaces)) return

			rack.spaces = rack.spaces.map(space => {
				let hasProduct = space && space.productId !== null && space.productId !== undefined

				return {
					entries: hasProduct ? [{
						productId: space.productId,
						batches: space.batches
					}] : []
				}
			})
		})
		data.version = 2
	}

	if (data.version === 2) {
		data.racks.forEach((rack, rackIndex) => {
			if (!rack || typeof rack !== `object`) return

			rack.name = `Rack ${rackIndex + 1}`
			rack.levelCount = 4
			rack.bayCount = 4
		})
		data.version = 3
	}

	if (data.version === 3) {
		data.rooms = [makeRoom(`Room 1`, data.racks)]
		delete data.racks
		data.version = 4
	}

	return data
}

let findProduct = (state, productId) => state.products.find(product => product.id === productId) || null

let findEntry = (space, productId) => space.entries.find(entry => entry.productId === productId) || null

let isValidSideCount = (sideCount) => Number.isInteger(sideCount) && sideCount >= 1 && sideCount <= maxRackSideCount

let isRoomNameTaken = (state, name, ignoredRoomIndex) => state.rooms.some((room, roomIndex) => roomIndex !== ignoredRoomIndex && room.name.toLowerCase() === name.toLowerCase())

let suggestRoomName = (state) => {
	let roomNumber = state.rooms.length + 1

	while (isRoomNameTaken(state, `Room ${roomNumber}`, -1)) roomNumber++

	return `Room ${roomNumber}`
}

// A new room starts with no racks and no floor spaces.
let addRoom = (state, rawName) => {
	let name = rawName.trim()

	if (name === ``) return makeResult(false, `Enter a room name.`)
	if (isRoomNameTaken(state, name, -1)) return makeResult(false, `A room with that name already exists.`)

	state.rooms.push(makeRoom(name, []))

	return makeResult(true, ``)
}

let renameRoom = (state, roomIndex, rawName) => {
	let name = rawName.trim()

	if (name === ``) return makeResult(false, `Enter a room name.`)
	if (isRoomNameTaken(state, name, roomIndex)) return makeResult(false, `A room with that name already exists.`)

	state.rooms[roomIndex].name = name

	return makeResult(true, ``)
}

let doesRoomHoldProducts = (room) => room.racks.some(rack => rack.spaces.some(space => space.entries.length > 0)) || room.floorSpaces.some(space => space.entries.length > 0)

// The last room cannot be removed, and a room that still holds products cannot be removed, so stock is never deleted by accident.
let removeRoom = (state, roomIndex) => {
	if (state.rooms.length === 1) return makeResult(false, `You need at least one room.`)
	if (doesRoomHoldProducts(state.rooms[roomIndex])) return makeResult(false, `This room still holds products. Empty its spaces first.`)

	state.rooms.splice(roomIndex, 1)

	return makeResult(true, ``)
}

let isRackNameTaken = (room, name, ignoredRackIndex) => room.racks.some((rack, rackIndex) => rackIndex !== ignoredRackIndex && rack.name.toLowerCase() === name.toLowerCase())

let suggestRackName = (room) => {
	let rackNumber = room.racks.length + 1

	while (isRackNameTaken(room, `Rack ${rackNumber}`, -1)) rackNumber++

	return `Rack ${rackNumber}`
}

// Rack names only need to be unique within their room. The size of a rack is fixed when it is added, because shrinking a rack could silently delete stock.
let addRack = (state, roomIndex, rawName, levelCount, bayCount) => {
	let room = state.rooms[roomIndex]
	let name = rawName.trim()

	if (name === ``) return makeResult(false, `Enter a rack name.`)
	if (isRackNameTaken(room, name, -1)) return makeResult(false, `A rack with that name already exists in this room.`)
	if (!isValidSideCount(levelCount) || !isValidSideCount(bayCount)) return makeResult(false, `Bays and levels must be whole numbers from 1 to ${maxRackSideCount}.`)

	room.racks.push(makeRack(name, levelCount, bayCount))

	return makeResult(true, ``)
}

let renameRack = (state, roomIndex, rackIndex, rawName) => {
	let room = state.rooms[roomIndex]
	let name = rawName.trim()

	if (name === ``) return makeResult(false, `Enter a rack name.`)
	if (isRackNameTaken(room, name, rackIndex)) return makeResult(false, `A rack with that name already exists in this room.`)

	room.racks[rackIndex].name = name

	return makeResult(true, ``)
}

// A rack that still holds products cannot be removed, so stock is never deleted by accident. A room may end up with no racks and only a floor.
let removeRack = (state, roomIndex, rackIndex) => {
	let room = state.rooms[roomIndex]

	if (room.racks[rackIndex].spaces.some(space => space.entries.length > 0)) return makeResult(false, `This rack still holds products. Empty its spaces first.`)

	room.racks.splice(rackIndex, 1)

	return makeResult(true, ``)
}

let addFloorSpace = (state, roomIndex) => {
	state.rooms[roomIndex].floorSpaces.push(makeSpace())

	return makeResult(true, ``)
}

// Only an empty floor space can be removed.
let removeFloorSpace = (state, roomIndex, spaceIndex) => {
	let room = state.rooms[roomIndex]

	if (room.floorSpaces[spaceIndex].entries.length > 0) return makeResult(false, `Empty this floor space first.`)

	room.floorSpaces.splice(spaceIndex, 1)

	return makeResult(true, ``)
}

let isNameTaken = (state, name, ignoredProductId) => state.products.some(product => product.id !== ignoredProductId && product.name.toLowerCase() === name.toLowerCase())

// A product with no colour assigned (null, or missing in older saved data) is shown neutrally rather than guessed at.
let determineProductColour = (product) => product && productColourNames.includes(product.colour) ? product.colour : null

let addProduct = (state, rawName, colour) => {
	let name = rawName.trim()
	let colourName = colour || null

	if (name === ``) return makeResult(false, `Enter a product name.`)
	if (isNameTaken(state, name, null)) return makeResult(false, `That product already exists.`)
	if (colourName !== null && !productColourNames.includes(colourName)) return makeResult(false, `Choose brown, white or no colour.`)

	state.products.push({
		id: state.nextProductId,
		name: name,
		colour: colourName
	})
	state.nextProductId++

	return makeResult(true, ``)
}

let renameProduct = (state, productId, rawName) => {
	let name = rawName.trim()

	if (name === ``) return makeResult(false, `Enter a product name.`)
	if (isNameTaken(state, name, productId)) return makeResult(false, `That product already exists.`)

	findProduct(state, productId).name = name

	return makeResult(true, ``)
}

let setProductColour = (state, productId, colour) => {
	let colourName = colour || null

	if (colourName !== null && !productColourNames.includes(colourName)) return makeResult(false, `Choose brown, white or no colour.`)

	findProduct(state, productId).colour = colourName

	return makeResult(true, ``)
}

let makeBoxCountText = (boxCount) => `${boxCount} ${boxCount === 1 ? `box` : `boxes`}`

// Plain wording for a number of spaces, so one space is never written as 1 spaces.
let makeSpaceCountText = (spaceCount) => `${spaceCount} ${spaceCount === 1 ? `space` : `spaces`}`

// A product that is still in any space cannot be removed, so no entry is ever left pointing at a missing product.
let removeProduct = (state, productId) => {
	let spaceCount = 0

	forEachSpace(state, space => {
		if (findEntry(space, productId) !== null) spaceCount++
	})

	if (spaceCount > 0) return makeResult(false, `Still in ${makeSpaceCountText(spaceCount)}. Remove it from ${spaceCount === 1 ? `that space` : `those spaces`} first.`)

	state.products = state.products.filter(product => product.id !== productId)

	return makeResult(true, ``)
}

let addProductToSpace = (state, location, productId) => {
	let space = getSpace(state, location)

	if (space.isUnavailable === true) return makeResult(false, `This location is unavailable.`)
	if (findProduct(state, productId) === null) return makeResult(false, `Choose a product.`)
	if (findEntry(space, productId) !== null) return makeResult(false, `That product is already in this space.`)

	space.entries.push({
		productId: productId,
		batches: []
	})

	return makeResult(true, ``)
}

let removeProductFromSpace = (state, location, productId) => {
	let space = getSpace(state, location)

	space.entries = space.entries.filter(entry => entry.productId !== productId)

	if (space.entries.length === 0) space.isUnfinished = false
}

let emptySpace = (state, location) => {
	let space = getSpace(state, location)

	space.entries = []
	space.isUnfinished = false
}

// An unfinished pallet is a partly built one. Only a space that holds something can be marked, and the mark is cleared when the space becomes empty.
let setSpaceUnfinished = (state, location, isUnfinished) => {
	let space = getSpace(state, location)

	if (space.entries.length === 0) return makeResult(false, `Add a product first.`)

	space.isUnfinished = isUnfinished === true

	return makeResult(true, ``)
}

// An unavailable location is hidden from the overview. It can only be marked while empty, so hidden stock is impossible, and floor spaces have no fixed slot to hide.
let setSpaceUnavailable = (state, location, isUnavailable) => {
	let space = getSpace(state, location)

	if (isFloorLocation(location)) return makeResult(false, `A floor space cannot be unavailable. Remove it instead.`)
	if (isUnavailable === true && space.entries.length > 0) return makeResult(false, `Empty this space first.`)

	space.isUnavailable = isUnavailable === true

	return makeResult(true, ``)
}

// Batch codes must be unique within one product in one space. The same code may appear under another product or in another space.
let addBatch = (state, location, productId, rawCode, boxCount) => {
	let entry = findEntry(getSpace(state, location), productId)
	let code = rawCode.trim()

	if (entry === null) return makeResult(false, `Add the product to this space first.`)
	if (code === ``) return makeResult(false, `Enter a batch code.`)
	if (!Number.isInteger(boxCount) || boxCount < 1) return makeResult(false, `Box count must be a whole number of at least 1.`)
	if (entry.batches.some(batch => batch.code.toLowerCase() === code.toLowerCase())) return makeResult(false, `This product already has that batch code in this space.`)

	entry.batches.push({
		code: code,
		boxCount: boxCount
	})

	return makeResult(true, ``)
}

// Taking the last box off a batch removes the batch.
let adjustBatch = (state, location, productId, batchIndex, deltaBoxCount) => {
	let entry = findEntry(getSpace(state, location), productId)
	let newBoxCount = entry.batches[batchIndex].boxCount + deltaBoxCount

	if (newBoxCount < 1) entry.batches.splice(batchIndex, 1)
	else entry.batches[batchIndex].boxCount = newBoxCount
}

let deleteBatch = (state, location, productId, batchIndex) => findEntry(getSpace(state, location), productId).batches.splice(batchIndex, 1)

// Three states: empty (no products), uncounted (products present but no batches entered anywhere, so the box count is unknown rather than zero) and stocked.
let determineSpaceStatus = (space) => {
	if (space.entries.length === 0) return `empty`
	if (space.entries.every(entry => entry.batches.length === 0)) return `uncounted`

	return `stocked`
}

// The room name is only included when there is more than one room, so a single-room inventory reads the same as before. The floor is one amorphous location, so its spaces are not numbered and share the label Floor.
let makeSpaceLabel = (state, location) => {
	let room = state.rooms[location.roomIndex]
	let roomPrefix = state.rooms.length > 1 ? `${room.name}, ` : ``

	if (isFloorLocation(location)) return `${roomPrefix}Floor`

	let rack = room.racks[location.rackIndex]

	return `${roomPrefix}${rack.name}, level ${Math.floor(location.spaceIndex / rack.bayCount) + 1}, bay ${(location.spaceIndex % rack.bayCount) + 1}`
}

// The colour tone of a space from the colours of the products in it. Products with no colour are ignored, and a space with none coloured is neutral.
let determineSpaceTone = (state, space) => {
	let colours = space.entries.map(entry => determineProductColour(findProduct(state, entry.productId)))

	if (colours.includes(`brown`) && colours.includes(`white`)) return `both`
	if (colours.includes(`brown`)) return `brown`
	if (colours.includes(`white`)) return `white`

	return `none`
}

// Totals per product across every room, with where each batch is. Entries with no batches are listed as locations with no batches, counted in uncountedSpaceCount, and add nothing to the total, so the total is a minimum.
let summariseStock = (state) => {
	return state.products.map(product => {
		let summary = {
			product: product,
			totalBoxes: 0,
			uncountedSpaceCount: 0,
			locations: []
		}

		forEachSpace(state, (space, location) => {
			let entry = findEntry(space, product.id)

			if (entry === null) return

			if (entry.batches.length === 0) summary.uncountedSpaceCount++

			summary.totalBoxes += entry.batches.reduce((total, batch) => total + batch.boxCount, 0)
			summary.locations.push({
				label: makeSpaceLabel(state, location),
				batches: entry.batches
			})
		})

		return summary
	})
}

// A product has stock if it is in any space, even when the box count there is not entered yet, because unknown is not zero. Only products in no space count as having no stock.
let hasStock = (summary) => summary.locations.length > 0

let makeProductHeading = (product) => determineProductColour(product) === null ? product.name : `${product.name} (${determineProductColour(product)})`

// Plain text of the stock list for pasting elsewhere. Products with stock come first, then products with no stock. A total that has uncounted pallets is written as at least, and a product with only uncounted pallets as unknown.
let makeStockText = (state, dateText) => {
	let lines = [`Racking Inventory stock, ${dateText}`]
	let summaries = summariseStock(state)

	if (state.products.length === 0) lines.push(``, `No products yet.`)

	summaries.filter(hasStock).forEach(summary => {
		let uncountedText = `${makeSpaceCountText(summary.uncountedSpaceCount)} not counted`
		let totalText = summary.uncountedSpaceCount === 0 ? makeBoxCountText(summary.totalBoxes) : summary.totalBoxes === 0 ? `count unknown, ${uncountedText}` : `at least ${makeBoxCountText(summary.totalBoxes)}, ${uncountedText}`

		lines.push(``, `${makeProductHeading(summary.product)}: ${totalText}`)
		summary.locations.forEach(location => lines.push(`  ${location.label}: ${location.batches.length === 0 ? `not counted` : location.batches.map(batch => `${batch.code} \u00D7 ${batch.boxCount}`).join(`, `)}`))
	})

	let withoutStock = summaries.filter(summary => !hasStock(summary))

	if (withoutStock.length > 0) {
		lines.push(``, `No stock:`)
		withoutStock.forEach(summary => lines.push(`  ${makeProductHeading(summary.product)}`))
	}

	return lines.join(`\n`)
}

let isValidSpace = (space, productIds) => {
	if (!space || !Array.isArray(space.entries)) return false
	if (space.isUnfinished !== undefined && typeof space.isUnfinished !== `boolean`) return false
	if (space.isUnavailable !== undefined && typeof space.isUnavailable !== `boolean`) return false
	if (new Set(space.entries.map(entry => entry.productId)).size !== space.entries.length) return false

	return space.entries.every(entry => productIds.includes(entry.productId) && Array.isArray(entry.batches) && entry.batches.every(batch => typeof batch.code === `string` && Number.isInteger(batch.boxCount) && batch.boxCount >= 1))
}

let isValidRack = (rack, productIds) => rack && typeof rack.name === `string` && rack.name.trim() !== `` && isValidSideCount(rack.levelCount) && isValidSideCount(rack.bayCount) && Array.isArray(rack.spaces) && rack.spaces.length === rack.levelCount * rack.bayCount && rack.spaces.every(space => isValidSpace(space, productIds))

// Checks the whole structure before saved or imported data is trusted.
let validateImportedState = (data) => {
	let invalid = makeResult(false, `This data is not a valid racking backup.`)

	if (!data || typeof data !== `object` || !Array.isArray(data.products) || !Array.isArray(data.rooms)) return invalid
	if (data.rooms.length < 1 || !Number.isInteger(data.nextProductId)) return invalid

	let productIds = data.products.map(product => product.id)

	if (data.products.some(product => !Number.isInteger(product.id) || typeof product.name !== `string` || product.id >= data.nextProductId || (product.colour !== undefined && product.colour !== null && !productColourNames.includes(product.colour)))) return invalid

	for (let room of data.rooms) {
		if (!room || typeof room.name !== `string` || room.name.trim() === `` || !Array.isArray(room.racks) || !Array.isArray(room.floorSpaces)) return invalid
		if (!room.racks.every(rack => isValidRack(rack, productIds)) || !room.floorSpaces.every(space => isValidSpace(space, productIds))) return invalid
	}

	return makeResult(true, ``)
}
