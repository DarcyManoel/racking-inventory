// Returns the saved inventory. Unreadable data is copied to a second key before an empty inventory is returned, so a later save cannot destroy it.
let loadState = () => {
	let loaded = {
		state: makeEmptyState(),
		warning: ``
	}

	try {
		let storedText = localStorage.getItem(storageKey)

		if (storedText === null) return loaded

		let storedState = upgradeState(JSON.parse(storedText))

		if (validateImportedState(storedState).isOk) {
			loaded.state = storedState
			return loaded
		}

		localStorage.setItem(`${storageKey}.unreadable`, storedText)
		loaded.warning = `Saved data could not be read, so the inventory is shown empty. The old data was kept under a second key and has not been deleted.`
	} catch (error) {
		loaded.warning = `Saved data could not be read, so the inventory is shown empty.`
	}

	return loaded
}

let saveState = (state) => {
	try {
		state.savedAtMillis = Date.now()
		localStorage.setItem(storageKey, JSON.stringify(state))

		return makeResult(true, ``)
	} catch (error) {
		return makeResult(false, `Could not save. Storage may be full or blocked (private browsing).`)
	}
}
