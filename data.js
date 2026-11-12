// Defaults and limits for racks, plus storage settings. A rack is a grid of levels (rows, level 1 is the floor) by bays (columns). Spaces are numbered from the floor level upwards, left to right within a level.
let defaultLevelCount = 4

let defaultBayCount = 4

let maxRackSideCount = 10

let storageKey = `freezerInventory`

let storageVersion = 3

// Product colours, one row per choice, columns: stored value, label. An empty stored value means no colour has been assigned.
let productColourRows = [[``, `No colour`], [`brown`, `Brown`], [`white`, `White`]]

let productColourNames = [`brown`, `white`]
