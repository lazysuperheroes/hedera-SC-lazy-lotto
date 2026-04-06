// AUTO-GENERATED FILE — do not edit.
// Source: abi/LazyTradeLotto.json
// Regenerate with: npm run build:abis
module.exports = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_prngSystemContract",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lazyGasStation",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lazyDelegateRegistry",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lshGen1",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lshGen2",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lshGen1Mutant",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_systemWallet",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_initialJackpot",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_lottoLossIncrement",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_burnPercentage",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadyRolled",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "message",
        "type": "string"
      }
    ],
    "name": "BadArguments",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidTeamSignature",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidUserSignature",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "string",
        "name": "_functionName",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "_sender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "_message",
        "type": "string"
      }
    ],
    "name": "ContractUpdate",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      }
    ],
    "name": "JackpotUpdate",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_user",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_jackpotThreshold",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_jackpotRoll",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_jackpotAmt",
        "type": "uint256"
      }
    ],
    "name": "JackpotWin",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_user",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_serial",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_nonce",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "_buyer",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_winRateThreshold",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_winRoll",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_minWinAmt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_maxWinAmt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_winAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_jackpotThreshold",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_jackpotRoll",
        "type": "uint256"
      }
    ],
    "name": "LottoRoll",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "Paused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "Unpaused",
    "type": "event"
  },
  {
    "stateMutability": "payable",
    "type": "fallback"
  },
  {
    "inputs": [],
    "name": "LSH_GEN1",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "LSH_GEN1_MUTANT",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "LSH_GEN2",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_WIN_RATE_THRESHOLD",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "boostJackpot",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "burnPercentage",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_user",
        "type": "address"
      }
    ],
    "name": "getBurnForUser",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getLottoStats",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "_jackpotPool",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_jackpotsWon",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_jackpotPaid",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_totalRolls",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_totalWins",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_totalPaid",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_lottoLossIncrement",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_maxJackpotPool",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "history",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isPaused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "jackpotPaid",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "jackpotPool",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "jackpotsWon",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lazyDelegateRegistry",
    "outputs": [
      {
        "internalType": "contract ILazyDelegateRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lazyGasStation",
    "outputs": [
      {
        "internalType": "contract ILazyGasStation",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lottoLossIncrement",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxJackpotPool",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "prngSystemContract",
    "outputs": [
      {
        "internalType": "contract IPrngSystemContract",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "serial",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "buyer",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "winRateThreshold",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minWinAmt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxWinAmt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "jackpotThreshold",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "teamSignature",
        "type": "bytes"
      }
    ],
    "name": "rollLotto",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "systemWallet",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalPaid",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalRolls",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalWins",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address payable",
        "name": "receiverAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "transferHbar",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "percentage",
        "type": "uint256"
      }
    ],
    "name": "updateBurnPercentage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "increment",
        "type": "uint256"
      }
    ],
    "name": "updateJackpotLossIncrement",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "maxThreshold",
        "type": "uint256"
      }
    ],
    "name": "updateMaxJackpotPool",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      }
    ],
    "name": "updateSystemWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
];
