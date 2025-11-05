const crypto = require('crypto');

/**
 * 加密工具类 - 用于加密敏感信息如API密钥
 */
class EncryptUtil {
  constructor() {
    // 从环境变量获取加密密钥，如果不存在则生成一个
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateRandomKey();
    if (!process.env.ENCRYPTION_KEY) {
      console.warn('未设置 ENCRYPTION_KEY 环境变量，使用随机生成的密钥。重启后密钥将变化，已加密数据将无法解密。');
    }
    // 确保密钥长度为32字节（AES-256）
    this.key = crypto.createHash('sha256').update(this.encryptionKey).digest();
  }

  /**
   * 生成随机密钥
   */
  generateRandomKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 加密文本
   * @param {string} text - 要加密的文本
   * @returns {string} 加密后的文本（Base64编码）
   */
  encrypt(text) {
    try {
      if (!text) return text;

      const iv = crypto.randomBytes(16); // 初始化向量
      const cipher = crypto.createCipheriv('aes-256-cbc', this.key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // 将IV和加密数据组合，使用:分隔
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('加密失败:', error);
      return text;
    }
  }

  /**
   * 解密文本
   * @param {string} encryptedText - 加密的文本
   * @returns {string} 解密后的文本
   */
  decrypt(encryptedText) {
    try {
      if (!encryptedText) return encryptedText;
      if (!encryptedText.includes(':')) return encryptedText; // 如果不包含分隔符，可能是未加密的文本

      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];

      const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('解密失败:', error);
      return encryptedText;
    }
  }

  /**
   * 检查文本是否已加密
   * @param {string} text - 要检查的文本
   * @returns {boolean} 是否已加密
   */
  isEncrypted(text) {
    return text && text.includes(':');
  }
}

module.exports = new EncryptUtil();
