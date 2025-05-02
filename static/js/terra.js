// Create the main terra object.
const Terra = {};

// Contains a reference to the current active app instance (Exam/IDE/Embed).
Terra.app = null;

// Contains (temporary) variables that are used throughout all apps where 'v'
// is an abbreviation for 'variables'.
Terra.v = {};

export default Terra;
