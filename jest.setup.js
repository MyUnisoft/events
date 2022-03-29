const dotenv = require("dotenv");
dotenv.config();

require("@myunisoft/utils").CONSTANTS.DEBUG = false;

jest.setTimeout(30000);
