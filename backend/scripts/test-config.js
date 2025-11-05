const configController = require('../src/controllers/settings/ConfigController');

/**
 * 配置管理功能测试脚本
 */
async function testConfig() {
  console.log('=== 开始测试配置管理功能 ===\n');

  try {
    // 1. 测试获取默认配置
    console.log('1. 测试获取默认配置...');
    const defaultConfig = await configController.getConfig();
    console.log('✓ 获取默认配置成功');
    console.log('  交易所类型:', defaultConfig.exchange.type);
    console.log('  交易金额:', defaultConfig.trading.amount);
    console.log('  杠杆倍数:', defaultConfig.trading.leverage);
    console.log('  AI模型:', defaultConfig.ai.model);
    console.log('  AI URL:', defaultConfig.ai.baseUrl);
    console.log('');

    // 2. 测试更新配置
    console.log('2. 测试更新配置...');
    const updates = {
      exchange: {
        type: 'binance',
        binance: {
          apiKey: 'test-api-key',
          secretKey: 'test-secret-key'
        },
        okx: {
          apiKey: '',
          secretKey: '',
          passphrase: ''
        }
      },
      trading: {
        amount: 20,
        leverage: 20,
        stopLoss: {
          enabled: true,
          percentage: 8
        }
      },
      ai: {
        baseUrl: 'https://api.deepseek.com',
        deepseekApiKey: 'test-ai-key'
      }
    };

    const updatedConfig = await configController.updateConfig(updates);
    console.log('✓ 配置更新成功');
    console.log('  交易所类型:', updatedConfig.exchange.type);
    console.log('  交易金额:', updatedConfig.trading.amount);
    console.log('  杠杆倍数:', updatedConfig.trading.leverage);
    console.log('  止盈百分比:', updatedConfig.trading.takeProfit.percentage);
    console.log('  止损百分比:', updatedConfig.trading.stopLoss.percentage);
    console.log('  止损启用:', updatedConfig.trading.stopLoss.enabled);
    console.log('  AI URL:', updatedConfig.ai.baseUrl);
    console.log('');

    // 3. 测试获取更新后的配置
    console.log('3. 测试重新获取配置...');
    const fetchedConfig = await configController.getConfig();
    console.log('✓ 重新获取配置成功');
    console.log('  交易所类型:', fetchedConfig.exchange.type);
    console.log('  交易金额:', fetchedConfig.trading.amount);
    console.log('  杠杆倍数:', fetchedConfig.trading.leverage);
    console.log('  止盈百分比:', fetchedConfig.trading.takeProfit.percentage);
    console.log('  止损百分比:', fetchedConfig.trading.stopLoss.percentage);
    console.log('  止损启用:', fetchedConfig.trading.stopLoss.enabled);
    console.log('  AI URL:', fetchedConfig.ai.baseUrl);
    console.log('');

    // 4. 测试重置配置
    console.log('4. 测试重置配置...');
    const resetConfig = await configController.resetConfig();
    console.log('✓ 配置重置成功');
    console.log('  交易金额:', resetConfig.trading.amount);
    console.log('  杠杆倍数:', resetConfig.trading.leverage);
    console.log('  止盈百分比:', resetConfig.trading.takeProfit.percentage);
    console.log('  止损百分比:', resetConfig.trading.stopLoss.percentage);
    console.log('  止损启用:', resetConfig.trading.stopLoss.enabled);
    console.log('  AI URL:', resetConfig.ai.baseUrl);
    console.log('');

    console.log('=== 所有测试通过！ ===');
    process.exit(0);
  } catch (error) {
    console.error('✗ 测试失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testConfig();
