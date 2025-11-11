{
    'name': "POS Force Offline Session",
    'category': 'Point of Sale',
    'version': '1.5',
    'depends': ['point_of_sale', 'web','pos_hr'],
    'data': [
        'security/ir.model.access.csv',
        'views/pos_offline_log_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            # 'pos_force_offline_session/static/src/js/pos_action_registry.js',

            # 'pos_force_offline_session/static/src/js/pos_offline_button_handler.js',
        ],

        'point_of_sale._assets_pos': [
            # 'pos_force_offline_session/static/src/js/pos_lazy_translation_patch.js',

            # 'pos_force_offline_session/static/src/js/pos_offline_service_mock.js',

            # 'pos_force_offline_session/static/src/js/pos_offline_rpc_patch.js',

            # 'pos_force_offline_session/static/src/js/pos_chrome_fix_patch.js',

            # 'pos_force_offline_session/static/pos_sw.js',
            
            'pos_force_offline_session/static/src/js/pos_user_alert_control.js',
            # 'pos_force_offline_session/static/src/js/pos_offline_data_handler.js',
            'pos_force_offline_session/static/src/js/pos_close_tab_confirm.js',
            'pos_force_offline_session/static/src/css/styles.css',

        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
