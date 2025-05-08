module.exports = {
	testEnvironment: "node",
	testMatch: ["**/*.test.ts"],
	transform: {
		"^.+\\.ts$": "ts-jest",
	},
	roots: ["<rootDir>/tests"],
};
