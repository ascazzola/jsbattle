const Service = require("moleculer").Service;
const DbService = require("moleculer-db");
const { ValidationError } = require("moleculer").Errors;
const _ = require('lodash');
const getDbAdapterConfig = require("../lib/getDbAdapterConfig.js");
const fs = require('fs');
const path = require('path');
const RankTable = require('./league/lib/RankTable.js');
const JavaScriptObfuscator = require('javascript-obfuscator');
const stripComments = require('strip-comments');
const validators = require("../validators");

class LeagueService extends Service {

  constructor(broker) {
    super(broker);
    this.ranktable = new RankTable();
    this.config = broker.serviceConfig.league;
    let adapterConfig = getDbAdapterConfig(broker.serviceConfig.data, 'league')
    this.parseServiceSchema({
      ...adapterConfig,
      name: "league",
      mixins: [DbService],
      settings: {
        idField: 'id',
        fields: [
          "id",
          "joinedAt",
          "ownerId",
          "ownerName",
          "scriptId",
          "scriptName",
          "fights_total",
          "fights_win",
          "fights_lose",
          "fights_error",
          "score",
          "code",
          "hash"
        ]
      },
      entityValidator: {
        id: validators.entityId({optional: true}),
        joinedAt: validators.createDate(),
        ownerId: validators.entityId(),
        ownerName: validators.entityName(),
        scriptId: validators.entityId(),
        scriptName: validators.entityName(),
        fights_total: {type: "number", positive: true},
        fights_win: {type: "number", positive: true},
        fights_lose: {type: "number", positive: true},
        fights_error: {type: "number", positive: true},
        score: {type: "number", positive: true},
        code: validators.code(),
        hash: validators.hash()
      },
      actions: {
        pickRandomOpponents: this.pickRandomOpponents,
        seedLeague: this.seedLeague,
        getUserSubmission: this.getUserSubmission,
        getHistory: this.getHistory,
        leaveLeague: this.leaveLeague,
        getLeagueSummary: this.getLeagueSummary,
        getUserRankTable: this.getUserRankTable,
        getScript: {
          params: {
            id: validators.entityId()
          },
          handler: this.getScript
        },
        joinLeague: {
          scriptId: validators.entityId(),
          handler: this.joinLeague
        },
        updateRank: {
          params: {
            id: validators.entityId(),
            winner: { type: "boolean" }
          },
          handler: this.updateRank
        },
        listRankTable: {
          params: {
            page: {type: "number", positive: true, min: 1, optional: true, convert: true},
            pageSize: {type: "number", positive: true, min: 1, max: 50, optional: true, convert: true}
          },
          handler: this.listRankTable
        },
      },
      hooks: {
        before: {
          create: [
            function addDefaults(ctx) {
              ctx.params.joinedAt = new Date();
              ctx.params.fights_total = 0;
              ctx.params.fights_win = 0;
              ctx.params.fights_lose = 0;
              ctx.params.fights_error = 0;
              ctx.params.score = ctx.params.score || 0;
              ctx.params = _.omit(ctx.params, ['id']);
              return ctx;
            }
          ]
        }
      },
      events: {
        "app.seed": async (ctx) => {
          await ctx.call('league.seedLeague', {})

          this.logger.info('Initializing Rank able');
          let initData = await ctx.call('league.find', {
            sort: '-score',
            fields: [
              "id",
              "ownerId",
              "ownerName",
              "scriptId",
              "scriptName",
              "joinedAt",
              "fights_total",
              "fights_win",
              "fights_lose",
              "fights_error",
              "score"
            ]
          });
          this.ranktable.init(initData);
          this.logger.info('Rank Table initialized');
        }
      }
    });
  }

  async getScript(ctx) {
    const userId = ctx.meta.user ? ctx.meta.user.id : null;
    if(!userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    const scriptId = ctx.params.id
    let response = await ctx.call('league.get', {
      id: scriptId,
      fields: [
        "id",
        "ownerName",
        "scriptName",
        "code"
      ]
    });

    return {
      id: response.id,
      scriptName: response.ownerName + '/' + response.scriptName,
      code: response.code
    };
  }

  async getHistory(ctx) {
    let items = await ctx.call('battleStore.find', {
      sort: '-createdAt',
      limit: 7,
      fields: [
        "id",
        "description",
        "meta",
        "createdAt"
      ]
    });
    items = items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      players: item.meta.map((player) => ({
        id: player.id,
        name: player.name,
        winner: player.winner
      }))
    }))
    return items;
  }

  async updateRank(ctx) {
    let entity = await this._get(ctx, {
      id: ctx.params.id,
      fields: [
        'id',
        'fights_total',
        'fights_win',
        'fights_lose',
        'score'
      ]
    });

    let newScore;
    if(ctx.params.winner) {
      newScore = entity.score + (10000 - entity.score)/25;
    } else {
      newScore = entity.score + (0 - entity.score)/25;
    }
    let newEntity = {
      id: entity.id,
      fights_total: entity.fights_total + 1,
      fights_win: entity.fights_win + (ctx.params.winner ? 1 : 0),
      fights_lose: entity.fights_lose + (ctx.params.winner ? 0 : 1),
      score: Math.round(newScore)
    }
    this._update(ctx, newEntity);
    this.ranktable.updateScore(
      newEntity.id,
      newEntity.score,
      newEntity.fights_total,
      newEntity.fights_win,
      newEntity.fights_lose
    );
  }

  async pickRandomOpponents(ctx) {
    let opponents = this.ranktable.pickRandom();
    let opponent1 = await ctx.call('league.get', {id: opponents[0].id})
    let opponent2 = await ctx.call('league.get', {id: opponents[1].id})
    return [
      opponent1,
      opponent2
    ]
  }

  async seedLeague(ctx) {
    const seedPath = path.resolve(__dirname, 'league', 'seed');
    const seedFiles = fs.readdirSync(seedPath)
      .map((filename, index) => ({
        ownerId: 'int-user-0000-1',
        ownerName: 'jsbattle',
        scriptId: 'int-script-0000-' + (index+1),
        scriptName: filename.replace(/\.tank$/, ''),
        code: fs.readFileSync(path.resolve(seedPath, filename), 'utf8')
      }))
      .map((entry) => new Promise(async (resolve) => {
        let existingEntry = await ctx.call('league.find', {
          query: {
            ownerName: 'jsbattle',
            scriptName: entry.scriptName,
          }
        });
        if(existingEntry.length == 0) {
          await ctx.call('league.create', entry);
        }
        resolve();
      }));

    await Promise.all(seedFiles);
  }

  async getUserSubmission(ctx) {
    const userId = ctx.meta.user ? ctx.meta.user.id : null;
    if(!userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    let leagueEntry = await ctx.call('league.find', {
      query: {
        ownerId: userId
      },
      limit: 1
    });

    if(leagueEntry.length === 0) {
      return {}
    }
    leagueEntry = leagueEntry[0];
    let items = await ctx.call('battleStore.find', {
      query: {
        owner: {$in: [leagueEntry.id]}
      },
      sort: '-createdAt',
      limit: 10,
      fields: [
        "id",
        "meta",
        "createdAt"
      ]
    });
    items = items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      players: item.meta.map((player) => ({
        id: player.id,
        name: player.name,
        winner: player.winner
      }))
    }));
    leagueEntry.history = items;

    leagueEntry.latest = true;
    try {
      let script = await ctx.call('scriptStore.getUserScript', { id: leagueEntry.scriptId});
      if(script && script.hash !== leagueEntry.hash) {
        leagueEntry.latest = false;
      }
    } catch (err) {
      this.logger.debug('Reference script not found')
    }

    return leagueEntry;
  }

  async joinLeague(ctx) {
    const userId = ctx.meta.user ? ctx.meta.user.id : null;
    if(!userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    let script = await ctx.call('scriptStore.getUserScript', { id: ctx.params.scriptId });

    if(script.ownerId != userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    let currentSubmission = await ctx.call('league.getUserSubmission', {});
    let startingScore = 0;
    if(ctx.params.scriptId === currentSubmission.scriptId) {
      startingScore = currentSubmission.score;
    }

    await this.leaveLeague(ctx);

    let code = script.code;
    if(this.config.obfuscate) {
      try {
        let prevSize = Math.round(code.length/1024);
        code = stripComments(code);
        code = code.replace(/importScripts\w*\([^)]*\)/g, '');
        code = JavaScriptObfuscator.obfuscate(code, {
          compact: true,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          debugProtectionInterval: false,
          disableConsoleOutput: true,
          identifierNamesGenerator: 'hexadecimal',
          log: false,
          renameGlobals: false,
          rotateStringArray: true,
          selfDefending: true,
          shuffleStringArray: true,
          splitStrings: false,
          stringArray: true,
          stringArrayEncoding: false,
          stringArrayThreshold: 0.75,
          unicodeEscapeSequence: false
        }).getObfuscatedCode();
        let currentSize = Math.round(code.length/1024);
        this.logger.info(`Code obfuscated ${prevSize}K -> ${currentSize}K`);

      } catch (err) {
        this.logger.warn(err);
      }
    } else {
      this.logger.info(`Code obfuscation disabled`);
    }

    const entity = await ctx.call('league.create', {
      ownerId: script.ownerId,
      ownerName: script.ownerName,
      scriptId: script.id,
      scriptName: script.scriptName,
      code: code,
      hash: script.hash,
      score: startingScore
    });

    this.ranktable.add({
      id: entity.id,
      ownerId: entity.ownerId,
      ownerName: entity.ownerName,
      scriptId: entity.scriptId,
      scriptName: entity.scriptName,
      joinedAt: entity.joinedAt,
      fights_total: entity.fights_total,
      fights_win: entity.fights_win,
      fights_lose: entity.fights_lose,
      fights_error: entity.fights_error,
      score: entity.score
    });

    return this.getLeagueSummary(ctx);
  }

  async leaveLeague(ctx) {
    const userId = ctx.meta.user ? ctx.meta.user.id : null;
    if(!userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    let submissions = await ctx.call('league.find', {
      query: {
        ownerId: userId
      }
    });

    let removals = submissions.map((submission) => ctx.call('league.remove', {
        id: submission.id
    }));

    for(let submission of submissions) {
      this.ranktable.remove(submission.id)
    }

    await Promise.all(removals);

    return this.getLeagueSummary(ctx);
  }

  async getUserRankTable(ctx) {
    const userId = ctx.meta.user ? ctx.meta.user.id : null;
    if(!userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    const fields = [
      "id",
      "ownerId",
      "ownerName",
      "scriptId",
      "scriptName",
      "joinedAt",
      "fights_total",
      "fights_win",
      "fights_lose",
      "fights_error",
      "hash",
      "score",
      "latest",
      "history"
    ];

    let submission = await this.getUserSubmission(ctx);
    submission = _.pick(submission, fields);

    return {
      submission,
      ranktable: this.ranktable.slice(submission.id, 9)
    }
  }

  async getLeagueSummary(ctx) {
    const userId = ctx.meta.user ? ctx.meta.user.id : null;
    if(!userId) {
      throw new ValidationError('Not Authorized!', 401);
    }

    let result = await this.getUserRankTable(ctx);
    return {
      ...result,
      history: await ctx.call('league.getHistory', {})
    }
  }

  listRankTable(ctx) {
    let page = ctx.params.page || 1;
    let pageSize = ctx.params.pageSize || 10;
    let total = this.ranktable.getLength();
    let totalPages = Math.ceil(total/pageSize);
    let offset = (page-1)*pageSize;
    let rows = this.ranktable.getData().slice(offset, offset+pageSize);
    return {
      rows,
      page,
      pageSize,
      total,
      totalPages
    }
  }
}
module.exports = LeagueService;
