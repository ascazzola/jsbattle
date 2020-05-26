"use strict";
const ConfigBroker = require("../../../app/lib/ConfigBroker.js");
const { ValidationError } = require("moleculer").Errors;
const { MoleculerClientError } = require("moleculer").Errors;

const createTestToken = (user) => ({
	id: (user ? user.id : '') || "123456",
	username: (user ? user.username : '') || "amy",
	role: (user ? user.role : '') || "user",
})

const ownScript = {
	ownerId: '92864',
	ownerName: 'monica83',
	scriptId: '89052534623',
	scriptName: 'reptori8743',
	code: '// hello 17487252'
}

describe("Test 'League' service", () => {

	let broker;

	beforeEach(async () => {

		let now = new Date().getTime();
		let config = {
			 auth: {
				 admins: [{provider: 'google', username: 'monica83' }]
			 },
			 league: {
					scheduleInterval: 10,
					timeLimit: 3000,
					teamSize: 3
				}
		 };
		broker = new ConfigBroker({ logger: false }, config, false);
		broker.createService({
				name: 'scriptStore',
				actions: {
					getUserScript: (ctx) => {
						switch(ctx.params.id) {
							case '999999':
								return {
									ownerId: '123456',
									ownerName: 'another_user',
									scriptId: '9324531928',
									scriptName: 'secret script',
									code: '// hello 48772'
								}
							case '152674':
								return ownScript
							default:
								throw new Error('not found')
						}
					}
				}
		})
		broker.loadService(__dirname + "../../../../app/services/League.service.js");
		await broker.start();
	});

	afterEach(() => broker.stop());


	it('should throw error when call getUserSubmission without login',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		await expect(
			broker.call('league.getUserSubmission', {}, {})
		).rejects.toThrow(/Not Authorized/i)
	});

	it('should throw error when call joinLeague without login',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		await expect(
			broker.call('league.joinLeague', {}, {})
		).rejects.toThrow(/Not Authorized/i)
	});

	it('should throw error when call leaveLeague without login',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		await expect(
			broker.call('league.leaveLeague', {}, {})
		).rejects.toThrow(/Not Authorized/i)
	});


	it('should throw error when call getLeagueSummary without login',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		await expect(
			broker.call('league.getLeagueSummary', {}, {})
		).rejects.toThrow(/Not Authorized/i)
	});

	it('should create league entry with defaults',  async () => {
		let entry = await broker.call('league.create', {}, {});
		expect(entry).toHaveProperty('id');
		expect(entry).toHaveProperty('joinedAt');
		expect(entry).toHaveProperty('fights_total', 0);
		expect(entry).toHaveProperty('fights_win', 0);
		expect(entry).toHaveProperty('fights_lose', 0);
		expect(entry).toHaveProperty('fights_error', 0);
		expect(entry).toHaveProperty('score', 0);
	});

	it('should return league summary',  async () => {
		const user1 = {
			username: 'monica83',
			role: 'user',
			id: '92864'
		}
		const user2 = {
			username: 'another_user',
			role: 'user',
			id: '123456'
		}
		await broker.call('league.joinLeague', {scriptId: '152674'}, {meta: {user: createTestToken(user1)}});
		let result = await broker.call('league.joinLeague', {scriptId: '999999'}, {meta: {user: createTestToken(user2)}});

		expect(result).toHaveProperty('submission');
		expect(result.submission).toHaveProperty('ownerId', '123456');
		expect(result).toHaveProperty('ranktable');
		expect(result.ranktable).toHaveLength(2);
	});

	it('should return empty league summary',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		let summary = await broker.call('league.getLeagueSummary', {}, {meta: {user: createTestToken(user)}});
		expect(summary).toHaveProperty('submission');
		expect(summary).toHaveProperty('ranktable');
		expect(summary.ranktable).toHaveLength(0);
		expect(Object.keys(summary.submission)).toHaveLength(0);
	});

	it('should not join the league without valid submission',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		await expect(
			broker.call('league.joinLeague', {scriptId: '00000'}, {meta: {user: createTestToken(user)}})
		).rejects.toThrow(/not found/)
	});


	it('should not join the league submission of another user',  async () => {
		const user = {
			username: 'john',
			role: 'user',
			id: '92864'
		}
		await expect(
			broker.call('league.joinLeague', {scriptId: '999999'}, {meta: {user: createTestToken(user)}})
		).rejects.toThrow(/Not Authorized/i)
	});

	it('should join the league',  async () => {
		const user = {
			username: 'monica83',
			role: 'user',
			id: '92864'
		}
		let result = await broker.call('league.joinLeague', {scriptId: '152674'}, {meta: {user: createTestToken(user)}});

		expect(result).toHaveProperty('submission');
		expect(result.submission).toHaveProperty('ownerId', '92864');
		expect(result.submission).toHaveProperty('ownerName', 'monica83');
		expect(result.submission).toHaveProperty('scriptName', ownScript.scriptName);
		expect(result.submission).toHaveProperty('joinedAt');
		expect(result.submission).toHaveProperty('score');
		expect(result.submission).toHaveProperty('fights_total');
		expect(result.submission).toHaveProperty('fights_win');
		expect(result.submission).toHaveProperty('fights_lose');
		expect(result.submission).toHaveProperty('fights_error');
		expect(result).toHaveProperty('ranktable');
		expect(result.ranktable).toHaveLength(1);
		expect(result.ranktable[0]).toHaveProperty('ownerId', '92864');
		expect(result.ranktable[0]).toHaveProperty('ownerName', 'monica83');
		expect(result.ranktable[0]).toHaveProperty('scriptName', ownScript.scriptName);
		expect(result.ranktable[0]).toHaveProperty('joinedAt');
		expect(result.ranktable[0]).toHaveProperty('score');
		expect(result.ranktable[0]).toHaveProperty('fights_total');
		expect(result.ranktable[0]).toHaveProperty('fights_win');
		expect(result.ranktable[0]).toHaveProperty('fights_lose');
		expect(result.ranktable[0]).toHaveProperty('fights_error');
	});

	it('should leave the league',  async () => {
		const user = {
			username: 'monica83',
			role: 'user',
			id: '92864'
		}
		await broker.call('league.joinLeague', {scriptId: '152674'}, {meta: {user: createTestToken(user)}});
		let summary = await broker.call('league.leaveLeague', {}, {meta: {user: createTestToken(user)}});

		expect(summary).toHaveProperty('submission');
		expect(summary).toHaveProperty('ranktable');
		expect(summary.ranktable).toHaveLength(0);
		expect(Object.keys(summary.submission)).toHaveLength(0);
	});

	it('should seed the league',  async () => {
		const user = {
			username: 'monica83',
			role: 'user',
			id: '92864'
		}
		await broker.emit('app.seed', {}, {});
		await broker.emit('app.seed', {}, {});

		let summary = await broker.call('league.leaveLeague', {}, {meta: {user: createTestToken(user)}});

		expect(summary).toHaveProperty('submission');
		expect(summary).toHaveProperty('ranktable');
		expect(summary.ranktable).toHaveLength(7);
		expect(Object.keys(summary.submission)).toHaveLength(0);
	});


	it('should pick random opponents',  async () => {
		await broker.emit('app.seed', {}, {});

		let opponents
		for(let i=0; i < 100; i++) {
			opponents = await broker.call('league.pickRandomOpponents', {});
			expect(opponents).toHaveLength(2);
			expect(opponents[0].id).not.toBe(opponents[1].id);
			expect(opponents[0].scriptId).not.toBe(opponents[1].scriptId);
		}
	});

	it('should not pick random opponents when league is empty',  async () => {
		const user = {
			username: 'monica83',
			role: 'user',
			id: '92864'
		}
		await broker.call('league.joinLeague', {scriptId: '152674'}, {meta: {user: createTestToken(user)}});
		await expect(
			broker.call('league.pickRandomOpponents', {})
		).rejects.toThrow(/no opponents/i)
	});

	it('should throw error when no input for update rank',  async () => {
		await expect(
			broker.call('league.updateRank', {})
		).rejects.toThrow(/parameter is required/i)

		await expect(
			broker.call('league.updateRank', {winner: true})
		).rejects.toThrow(/parameter is required/i)

		await expect(
			broker.call('league.updateRank', {id: '8871234'})
		).rejects.toThrow(/parameter is required/i)
	});

	it('should update rank',  async () => {
		const user = {
			username: 'monica83',
			role: 'user',
			id: '92864'
		}
		let createResult = await broker.call('league.joinLeague', {scriptId: '152674'}, {meta: {user: createTestToken(user)}});
		let entityId = createResult.submission.id;
		await broker.call('league.updateRank', {id: entityId, winner: true});
		await broker.call('league.updateRank', {id: entityId, winner: true});
		await broker.call('league.updateRank', {id: entityId, winner: false});

		let entity = await broker.call('league.get', {id: entityId});
		expect(entity).toHaveProperty('fights_total', 3);
		expect(entity).toHaveProperty('fights_win', 2);
		expect(entity).toHaveProperty('fights_lose', 1);
		expect(entity).toHaveProperty('score', 753);
	});

});
