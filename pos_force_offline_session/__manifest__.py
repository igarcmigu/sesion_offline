{
    'name': "POS Force Offline Session",
    'category': 'Point of Sale',
    'version': '17.0.1.0.0',
    'depends': ['point_of_sale', 'web'], 
    'assets': {
        'web.assets_backend': [
            
            'pos_force_offline_session/static/src/js/pos_action_registry.js',

            'pos_force_offline_session/static/src/js/pos_offline_button_handler.js',
        ],

        'point_of_sale._assets_pos': [
            'pos_force_offline_session/static/src/js/pos_offline_rpc_patch.js',
            'pos_force_offline_session/static/pos_sw.js',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}