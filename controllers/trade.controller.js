const Stock = require('../models/stock.model');
const WalletController = require('./wallet.controller');
const TransactionController = require('./transaction.controller');
const LogController = require('./log.controller');
const UtilitiesController = require('./utilities.controllers');
const dateFunctions = require('dayjs');
const axios = require('axios');

const arrCrypto = [
	{ '1. symbol': 'BTC', '2. name': 'Bitcoin' },
	{ '1. symbol': 'ETH', '2. name': 'Etherum' },
	{ '1. symbol': 'LTC', '2. name': 'LiteCoin' },
	{ '1. symbol': 'USDT', '2. name': 'Tether' },
	{ '1. symbol': 'XPR', '2. name': 'XPR' },
];
class TradeController {
	static async get(_id) {
		const stock = await Stock.findById(_id);
		if (stock) {
			stock.populate('user');
			stock.populate('stock');
		}
		return stock;
	}
	static async getByUserSymbol(_user, _symbol) {
		const stock = await Stock.findOne({ user: _user, symbol: _symbol });
		if (stock) {
			stock.populate('user');
			stock.populate('stock');
		}
		return stock;
	}
	static async add(_stock) {
		const newStock = await Stock.create(_stock);
		if (newStock) {
			this.registerLog(newStock, 'New');
		}
		return newStock;
	}
	static async set(_stock) {
		const editStock = await Stock.findByIdAndUpdate(_stock._id, _stock, {
			new: true,
		});
		if (editStock) {
			this.registerLog(editStock, 'Editing');
		}
		return editStock;
	}
	static async buy(_user, _symbol, _name, _type, _units, _price) {
		try {
			const userWallet = await WalletController.getByUserId(_user);
			const buyStock = await this.getByUserSymbol(_user, _symbol);
			//let buyPrice = await this.getSymbolPrice(_symbol, _type);
			const buyAmount = _units * _price;
			if (buyAmount <= userWallet.amount) {
				const newWallet = await WalletController.buy(userWallet._id, buyAmount);
				if (buyStock) {
					buyStock.units += _units;
					await TransactionController.add({
						date: new Date(),
						user: userWallet.user,
						stock: buyStock._id,
						type: 'buy',
						units: _units,
						price: _price,
					});
					await this.set(buyStock);
					await this.registerLog(buyStock, 'Buy');
					return { buyStock, newWallet };
				} else {
					const newStock = await Stock.create({
						user: _user,
						symbol: _symbol,
						name: _name,
						type: _type,
						units: _units,
					});
					await TransactionController.add({
						date: new Date(),
						user: userWallet.user,
						stock: newStock._id,
						type: 'buy',
						units: _units,
						price: _price,
					});
					await this.registerLog(newStock, 'Buy');
					return { newStock, newWallet };
				}
			} else {
				throw new Error(
					`You don't have sufficient amount in your wallet for this buy. Wallet: ${userWallet.amount}, Total Cost: ${buyAmount}`
				);
			}
		} catch (err) {
			throw err;
		}
	}
	static async sell(_user, _symbol, _units, _price) {
		try {
			const sellStock = await this.getByUserSymbol(_user, _symbol);
			console.log(sellStock);
			if (sellStock && sellStock.units >= _units) {
				const userWallet = await WalletController.findOne({ user: _user });
				// const sellPrice = await this.getSymbolPrice(
				// 	sellStock.symbol,
				// 	sellStock.type
				// );
				console.log(userWallet);
				const sellPrice = _price;
				const sellAmount = _units * sellPrice;
				sellStock.units -= _units;
				const editStock = await this.set(sellStock);
				await TransactionController.add({
					date: new Date(),
					user: _user,
					stock: sellStock._id,
					type: 'sell',
					units: _units,
					price: sellPrice,
				});
				const newWallet = await WalletController.sell(
					userWallet._id,
					sellAmount
				);
				await this.registerLog(sellStock, 'Sell');
				return newWallet;
			} else {
				throw new Error(`You don't have sufficient units for this sell`);
			}
		} catch (err) {
			throw err;
		}
	}
	static async list() {
		return await Stock.find().populate('user').populate('stock');
	}
	static async listByUser(_user) {
		return await Stock.find({ user: _user }).populate('stock');
	}
	static async registerLog(_stock, _action) {
		await LogController.register(
			`${_action} stock ${_stock._id} of user ${_stock.user}`,
			_stock.user
		);
	}
	static async getSymbolPrice(_symbol, _type) {
		const key = process.env.API_KEY;
		const functionName =
			_type === 'crypto' ? 'CURRENCY_EXCHANGE_RATE' : 'GLOBAL_QUOTE';
		let apiUrl = `https://www.alphavantage.co/query?function=${functionName}&apikey=${key}`;
		switch (_type) {
			case 'crypto':
				apiUrl += `&from_currency=${_symbol}&to_currency=EUR`;
				break;
			default:
				apiUrl += `&symbol=${_symbol}`;
				break;
		}
		let price = 1;
		try {
			const responseFromAPI = await axios.get(apiUrl);
			//console.log(responseFromAPI);
			switch (_type) {
				case 'crypto':
					price =
						responseFromAPI.data['Realtime Currency Exchange Rate'][
							'5. Exchange Rate'
						];
					break;
				default:
					price = responseFromAPI.data['Global Quote']['05. price'];
					break;
			}
			return price;
		} catch (err) {
			console.log('Error while getting the data: ', err);
			return price;
		}
	}
	static async searchSymbol(_keywords, _type) {
		if (_type === 'crypto') {
			return arrCrypto;
		} else {
			const key = process.env.API_KEY;
			const functionName = 'SYMBOL_SEARCH';
			const apiUrl = `https://www.alphavantage.co/query?function=${functionName}&keywords=${_keywords}&apikey=${key}`;
			try {
				const responseFromAPI = await axios.get(apiUrl);
				return responseFromAPI.data['bestMatches'];
			} catch (err) {
				console.log('Error while getting the data: ', err);
			}
		}
	}
	static async getEvolutionSymbolsByUser(_id) {
		const key = process.env.API_KEY;
		const symbols = await this.listByUser(_id);
		const returnLabels = await UtilitiesController.getLastNDays(30);
		const returnDatasets = [];
		await Promise.all(
			symbols.map(async function (sym, index) {
				const itemData = { symbol: sym.symbol, dataset: [] };
				let dataArrayName =
					sym.type === 'crypto'
						? 'Time Series (Digital Currency Daily)'
						: 'Time Series (Daily)';
				let dataFieldName =
					sym.type === 'crypto' ? '4a. close (EUR)' : '4. close';
				let functionName =
					sym.type === 'crypto'
						? 'DIGITAL_CURRENCY_DAILY'
						: 'TIME_SERIES_DAILY';

				const apiUrl =
					`https://www.alphavantage.co/query?function=${functionName}&symbol=${sym.symbol}&apikey=${key}` +
					(sym.type === 'crypto' ? '&market=EUR' : '');
				try {
					axios.get(apiUrl).then((responseFromAPI) => {
						if (responseFromAPI && responseFromAPI.data[dataArrayName]) {
							const dataToProcess = responseFromAPI.data[dataArrayName];
							const dataKeys = Object.keys(dataToProcess);
							returnLabels.forEach((date) => {
								if (
									dataKeys.find(
										(d) => d === dateFunctions(date).format('YYYY-MM-DD')
									)
								) {
									itemData.dataset.push(
										parseFloat(
											dataToProcess[dateFunctions(date).format('YYYY-MM-DD')][
												dataFieldName
											]
										)
									);
								} else {
									itemData.dataset.push(0.0);
								}
							});
						}
						console.log(itemData);
						console.log(itemData.dataset.length);
						if (itemData.dataset.length > 0) {
							returnDatasets.push(itemData);
						}
					});
				} catch (err) {
					console.log('Error while getting the data: ', err);
				}
			})
		);
		console.log('Datasets', returnDatasets);
		return { labels: returnLabels, datasets: returnDatasets };
	}

	static async groupedByUserBySymbol(_id) {
		const trades = await this.listByUser(_id);
		const transactions = await TransactionController.listByUser(_id);
		return trades.map((trade) => ({
			_id: { symbol: trade.symbol, name: trade.name },
			amount: transactions
				.filter((t) => t.stock.symbol === trade.symbol)
				.reduce(
					(total, trans) =>
						(total += trans.total * (trans.type === 'sell' ? -1 : 1)),
					0
				),
		}));
	}
}
module.exports = TradeController;
