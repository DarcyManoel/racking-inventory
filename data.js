// Freezer layout and storage settings. Spaces are numbered from the floor level upwards, left to right within a level, so space 0 is the floor level in the first bay.
let rackCount = 2

let levelCount = 4

let bayCount = 4

let storageKey = `freezerInventory`

let storageVersion = 2

// Product colours, one row per choice, columns: stored value, label. An empty stored value means no colour has been assigned.
let productColourRows = [[``, `No colour`], [`brown`, `Brown`], [`white`, `White`]]

let productColourNames = [`brown`, `white`]
