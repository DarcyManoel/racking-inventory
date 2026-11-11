let makeResult = (isOk, message) => {
	return {
		isOk: isOk,
		message: message
	}
}

// Builds an empty inventory in which every space holds no products. A space holds a list of entries, one per product, each with its own batches.
let makeEmptyState = () => {
	let racks = []

	for (let rackIndex = 0; rackIndex < rackCount; rackIndex++) {
		let spaces = []

		for (let spaceIndex = 0; spaceIndex < levelCount * bayCount; spaceIndex++) {
			spaces.push({
				entries: []
			})
		}

		racks.push({
			spaces: spaces
		})
	}

	return {
		version: storageVersion,
		nextProductId: 1,
		products: [],
		racks: racks,
		savedAtMillis: null
	}
}

// Brings version 1 data (one productId plus batches per space) up to version 2 (a list of entries per space). Anything else is returned unchanged for the validator to judge.
let upgradeState = (data) => {
	if (!data || typeof data !== `object` || data.version !== 1 || !Array.isArray(data.racks)) return data

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
	data.version = storageVersion

	return data
}

let findProduct = (state, productId) => state.products.find(product => product.id === productId) || null

let getSpace = (state, rackIndex, spaceIndex) => state.racks[rackIndex].spaces[spaceIndex]

let findEntry = (space, productId) => space.entries.find(entry => entry.productId === productId) || null

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

// A product that is still in any space cannot be removed, so no entry is ever left pointing at a missing product.
let makeBoxCountText = (boxCount) => `${boxCount} ${boxCount === 1 ? `box` : `boxes`}`

// Plain wording for a number of spaces, so one space is never written as 1 spaces.
let makeSpaceCountText = (spaceCount) => `${spaceCount} ${spaceCount === 1 ? `space` : `spaces`}`

let removeProduct = (state, productId) => {
	let spaceCount = 0

	state.racks.forEach(rack => rack.spaces.forEach(space => {
		if (findEntry(space, productId) !== null) spaceCount++
	}))

	if (spaceCount > 0) return makeResult(false, `Still in ${makeSpaceCountText(spaceCount)}. Remove it from ${spaceCount === 1 ? `that space` : `those spaces`} first.`)

	state.products = state.products.filter(product => product.id !== productId)

	return makeResult(true, ``)
}

let addProductToSpace = (state, rackIndex, spaceIndex, productId) => {
	let space = getSpace(state, rackIndex, spaceIndex)

	if (findProduct(state, productId) === null) return makeResult(false, `Choose a product.`)
	if (findEntry(space, productId) !== null) return makeResult(false, `That product is already in this space.`)

	space.entries.push({
		productId: productId,
		batches: []
	})

	return makeResult(true, ``)
}

let removeProductFromSpace = (state, rackIndex, spaceIndex, productId) => {
	let space = getSpace(state, rackIndex, spaceIndex)

	space.entries = space.entries.filter(entry => entry.productId !== productId)

	if (space.entries.length === 0) space.isUnfinished = false
}

let emptySpace = (state, rackIndex, spaceIndex) => {
	let space = getSpace(state, rackIndex, spaceIndex)

	space.entries = []
	space.isUnfinished = false
}

// An unfinished pallet is a partly built one. Only a space that holds something can be marked, and the mark is cleared when the space becomes empty.
let setSpaceUnfinished = (state, rackIndex, spaceIndex, isUnfinished) => {
	let space = getSpace(state, rackIndex, spaceIndex)

	if (space.entries.length === 0) return makeResult(false, `Add a product first.`)

	space.isUnfinished = isUnfinished === true

	return makeResult(true, ``)
}

// Batch codes must be unique within one product in one space. The same code may appear under another product or in another space.
let addBatch = (state, rackIndex, spaceIndex, productId, rawCode, boxCount) => {
	let entry = findEntry(getSpace(state, rackIndex, spaceIndex), productId)
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
let adjustBatch = (state, rackIndex, spaceIndex, productId, batchIndex, deltaBoxCount) => {
	let entry = findEntry(getSpace(state, rackIndex, spaceIndex), productId)
	let newBoxCount = entry.batches[batchIndex].boxCount + deltaBoxCount

	if (newBoxCount < 1) entry.batches.splice(batchIndex, 1)
	else entry.batches[batchIndex].boxCount = newBoxCount
}

let deleteBatch = (state, rackIndex, spaceIndex, productId, batchIndex) => findEntry(getSpace(state, rackIndex, spaceIndex), productId).batches.splice(batchIndex, 1)

// Three states: empty (no products), uncounted (products present but no batches entered anywhere, so the box count is unknown rather than zero) and stocked.
let determineSpaceStatus = (space) => {
	if (space.entries.length === 0) return `empty`
	if (space.entries.every(entry => entry.batches.length === 0)) return `uncounted`

	return `stocked`
}

let makeSpaceLabel = (rackIndex, spaceIndex) => `Rack ${rackIndex + 1}, level ${Math.floor(spaceIndex / bayCount) + 1}, bay ${(spaceIndex % bayCount) + 1}`

// The colour tone of a space from the colours of the products in it. Products with no colour are ignored, and a space with none coloured is neutral.
let determineSpaceTone = (state, space) => {
	let colours = space.entries.map(entry => determineProductColour(findProduct(state, entry.productId)))

	if (colours.includes(`brown`) && colours.includes(`white`)) return `both`
	if (colours.includes(`brown`)) return `brown`
	if (colours.includes(`white`)) return `white`

	return `none`
}

// Totals per product with where each batch is. Entries with no batches are listed as locations with no batches, counted in uncountedSpaceCount, and add nothing to the total, so the total is a minimum.
let summariseStock = (state) => {
	return state.products.map(product => {
		let summary = {
			product: product,
			totalBoxes: 0,
			uncountedSpaceCount: 0,
			locations: []
		}

		state.racks.forEach((rack, rackIndex) => rack.spaces.forEach((space, spaceIndex) => {
			let entry = findEntry(space, product.id)

			if (entry === null) return

			if (entry.batches.length === 0) summary.uncountedSpaceCount++

			summary.totalBoxes += entry.batches.reduce((total, batch) => total + batch.boxCount, 0)
			summary.locations.push({
				label: makeSpaceLabel(rackIndex, spaceIndex),
				batches: entry.batches
			})
		}))

		return summary
	})
}

// Plain text of the stock list for pasting elsewhere. A total that has uncounted pallets is written as at least, and a product with only uncounted pallets as unknown, because unknown is not zero.
let makeStockText = (state, dateText) => {
	let lines = [`Freezer stock, ${dateText}`]

	if (state.products.length === 0) lines.push(``, `No products yet.`)

	summariseStock(state).forEach(summary => {
		let colour = determineProductColour(summary.product)
		let heading = colour === null ? summary.product.name : `${summary.product.name} (${colour})`
		let uncountedText = `${makeSpaceCountText(summary.uncountedSpaceCount)} not counted`
		let totalText = summary.locations.length === 0 ? `not in any space` : summary.uncountedSpaceCount === 0 ? makeBoxCountText(summary.totalBoxes) : summary.totalBoxes === 0 ? `count unknown, ${uncountedText}` : `at least ${makeBoxCountText(summary.totalBoxes)}, ${uncountedText}`

		lines.push(``, `${heading}: ${totalText}`)
		summary.locations.forEach(location => lines.push(`  ${location.label}: ${location.batches.length === 0 ? `not counted` : location.batches.map(batch => `${batch.code} \u00D7 ${batch.boxCount}`).join(`, `)}`))
	})

	return lines.join(`\n`)
}

// Checks the whole structure before saved or imported data is trusted.
let validateImportedState = (data) => {
	let invalid = makeResult(false, `This data is not a valid freezer backup.`)

	if (!data || typeof data !== `object` || !Array.isArray(data.products) || !Array.isArray(data.racks)) return invalid
	if (data.racks.length !== rackCount || !Number.isInteger(data.nextProductId)) return invalid

	let productIds = data.products.map(product => product.id)

	if (data.products.some(product => !Number.isInteger(product.id) || typeof product.name !== `string` || product.id >= data.nextProductId || (product.colour !== undefined && product.colour !== null && !productColourNames.includes(product.colour)))) return invalid

	for (let rack of data.racks) {
		if (!rack || !Array.isArray(rack.spaces) || rack.spaces.length !== levelCount * bayCount) return invalid

		for (let space of rack.spaces) {
			if (!space || !Array.isArray(space.entries)) return invalid
			if (space.isUnfinished !== undefined && typeof space.isUnfinished !== `boolean`) return invalid
			if (new Set(space.entries.map(entry => entry.productId)).size !== space.entries.length) return invalid

			for (let entry of space.entries) {
				if (!productIds.includes(entry.productId) || !Array.isArray(entry.batches)) return invalid
				if (entry.batches.some(batch => typeof batch.code !== `string` || !Number.isInteger(batch.boxCount) || batch.boxCount < 1)) return invalid
			}
		}
	}

	return makeResult(true, ``)
}
