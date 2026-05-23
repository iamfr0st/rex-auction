fx_version 'cerulean'
rdr3_warning 'I acknowledge that this is a prerelease build of RedM, and I am aware my resources *will* become incompatible once RedM ships.'
game 'rdr3'

author 'RexShack'
description 'Real-time auction system for RSG Framework'
version '2.0.11'

rdr3_warning 'I understand that RedM is not officially supported and this resource may break at any time'

ui_page 'web/dist/index.html'

files {
    'web/dist/**/*'
}

shared_scripts {
    '@ox_lib/init.lua',
    '@oxmysql/lib/MySQL.lua',
    'config.lua',
    'shared/money.lua'
}

client_scripts {
    'client/*.lua'
}

server_scripts {
    'server/webhooks.lua',
    'server/main.lua',
    'server/versionchecker.lua'
}

dependencies {
    'rsg-core',
    'ox_lib',
    'oxmysql',
    'ox_target'
}
